import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ShieldCheck, ShieldAlert, Lock, RefreshCw, Plus, Check, Copy,
  ExternalLink, Trash2, AlertTriangle, AlertCircle, CheckCircle2,
  Calendar, Clock, Server, Terminal, Globe, Download, Eye, FileText,
  KeyRound, Flame, ArrowRight, Play, Sparkles, Filter, Search, X,
  Layers, HardDrive, Info, Activity, Radio, Cpu, Wrench
} from 'lucide-react';
import { useConnectionStore } from '../../lib/store';
import { useUserPrivilege } from '../../lib/permissions';
import { SslCertificate, CertbotStatus, IssueCertForm, SelfSignedForm, SslDiagnosticResult } from './types';
import {
  detectCertbotStatus,
  installCertbot,
  installCertbotPlugin,
  installWebServer,
  listCertificates,
  issueCertificate,
  renewCertificates,
  enableAutoRenewTimer,
  revokeCertificate,
  deleteCertificate,
  inspectCertificate,
  readCertificatePem,
  generateSelfSignedCertificate,
  testSslDiagnostics,
} from './certbot-service';

export default function SslManager() {
  const activeConnectionId = useConnectionStore(s => s.activeConnectionId);
  const activeServer = useConnectionStore(s => {
    const id = s.activeConnectionId;
    return id ? s.connections.find(c => c.id === id) : null;
  });
  const { hasSudo, isRoot, username } = useUserPrivilege();

  const [activeTab, setActiveTab] = useState<'certificates' | 'issue' | 'renewal' | 'self-signed' | 'diagnostics'>('certificates');
  const [certificates, setCertificates] = useState<SslCertificate[]>([]);
  const [certbotStatus, setCertbotStatus] = useState<CertbotStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'all' | 'valid' | 'expiring' | 'expired'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Notification Banner
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);

  // Modals & Drawers
  const [selectedCertForInspect, setSelectedCertForInspect] = useState<SslCertificate | null>(null);
  const [inspectDetails, setInspectDetails] = useState<string>('');
  const [isInspecting, setIsInspecting] = useState(false);

  const [selectedCertForPem, setSelectedCertForPem] = useState<SslCertificate | null>(null);
  const [pemContent, setPemContent] = useState<string>('');
  const [isReadingPem, setIsReadingPem] = useState(false);
  const [copiedPem, setCopiedPem] = useState(false);

  const [certToDelete, setCertToDelete] = useState<SslCertificate | null>(null);
  const [deleteAction, setDeleteAction] = useState<'delete' | 'revoke'>('delete');
  const [isDeleting, setIsDeleting] = useState(false);

  // Issue Certificate Form State
  const [issueForm, setIssueForm] = useState<IssueCertForm>({
    domains: '',
    email: '',
    plugin: 'nginx',
    webrootPath: '/var/www/html',
    agreeTos: true,
    redirectHttps: true,
    dryRun: false,
    keyType: 'ecdsa',
    rsaKeySize: 2048,
  });
  const [isIssuing, setIsIssuing] = useState(false);
  const [issueOutput, setIssueOutput] = useState<string | null>(null);

  // Web Server / Plugin Dependency Missing Modal (only asked when user selects that webserver)
  const [missingDepModal, setMissingDepModal] = useState<{
    type: 'missing_webserver' | 'missing_plugin';
    webserver: 'nginx' | 'apache';
    title: string;
    description: string;
  } | null>(null);

  // Renewal Actions
  const [isRenewing, setIsRenewing] = useState(false);
  const [renewingCertId, setRenewingCertId] = useState<string | null>(null);
  const [renewalOutput, setRenewalOutput] = useState<string | null>(null);

  // Self-Signed Generator Form
  const [selfSignedForm, setSelfSignedForm] = useState<SelfSignedForm>({
    domain: 'localhost',
    organization: 'Development Local CA',
    country: 'US',
    validDays: 365,
    outputDir: '/etc/ssl/certs',
  });
  const [isGeneratingSelfSigned, setIsGeneratingSelfSigned] = useState(false);
  const [selfSignedResult, setSelfSignedResult] = useState<{
    success: boolean;
    certPath: string;
    keyPath: string;
    output: string;
  } | null>(null);

  // SSL Diagnostics State
  const [diagDomain, setDiagDomain] = useState<string>('');
  const [diagPort, setDiagPort] = useState<number>(443);
  const [isTestingDiag, setIsTestingDiag] = useState(false);
  const [diagResult, setDiagResult] = useState<SslDiagnosticResult | null>(null);

  // Certbot One-Click Installer State & Modal
  const [isInstallingCertbot, setIsInstallingCertbot] = useState(false);
  const [installOutput, setInstallOutput] = useState<string | null>(null);
  const [showInstallAlertModal, setShowInstallAlertModal] = useState(false);
  const [copiedInstallCmd, setCopiedInstallCmd] = useState(false);

  // Generic Component Installing State
  const [installingComponent, setInstallingComponent] = useState<string | null>(null);

  // Load everything on mount or server switch
  const refreshAll = useCallback(async () => {
    if (!activeConnectionId) return;
    setIsLoading(true);
    setMessage(null);
    try {
      const [status, certs] = await Promise.all([
        detectCertbotStatus(activeConnectionId),
        listCertificates(activeConnectionId),
      ]);
      setCertbotStatus(status);
      setCertificates(certs);

      // Auto-populate webserver plugin if detected and not already customized
      if (status.webServers.nginx) {
        setIssueForm(prev => ({ ...prev, plugin: 'nginx' }));
      } else if (status.webServers.apache) {
        setIssueForm(prev => ({ ...prev, plugin: 'apache' }));
      } else {
        setIssueForm(prev => ({ ...prev, plugin: 'standalone' }));
      }
    } catch (err: any) {
      setMessage({ text: `Failed to load certificate data: ${err?.message || err}`, isError: true });
    } finally {
      setIsLoading(false);
    }
  }, [activeConnectionId]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  // KPI Calculations
  const stats = useMemo(() => {
    const total = certificates.length;
    const valid = certificates.filter(c => c.status === 'valid').length;
    const expiring = certificates.filter(c => c.status === 'expiring_soon').length;
    const expired = certificates.filter(c => c.status === 'expired').length;
    return { total, valid, expiring, expired };
  }, [certificates]);

  // Filtered Certificates
  const filteredCertificates = useMemo(() => {
    return certificates.filter(c => {
      const matchesSearch = 
        c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.domains.some(d => d.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (c.issuer && c.issuer.toLowerCase().includes(searchQuery.toLowerCase()));

      let matchesStatus = true;
      if (statusFilter === 'valid') matchesStatus = c.status === 'valid';
      if (statusFilter === 'expiring') matchesStatus = c.status === 'expiring_soon';
      if (statusFilter === 'expired') matchesStatus = c.status === 'expired';

      return matchesSearch && matchesStatus;
    });
  }, [certificates, searchQuery, statusFilter]);

  // Inspect Certificate
  const handleInspect = async (cert: SslCertificate) => {
    setSelectedCertForInspect(cert);
    setIsInspecting(true);
    setInspectDetails('Loading certificate details via openssl...');
    try {
      const details = await inspectCertificate(activeConnectionId!, cert.certPath);
      setInspectDetails(details);
    } catch (err: any) {
      setInspectDetails(`Failed to inspect certificate: ${err?.message || err}`);
    } finally {
      setIsInspecting(false);
    }
  };

  // View PEM Content
  const handleViewPem = async (cert: SslCertificate) => {
    setSelectedCertForPem(cert);
    setIsReadingPem(true);
    setCopiedPem(false);
    try {
      const pem = await readCertificatePem(activeConnectionId!, cert.certPath);
      setPemContent(pem);
    } catch (err: any) {
      setPemContent(`Failed to read certificate PEM: ${err?.message || err}`);
    } finally {
      setIsReadingPem(false);
    }
  };

  // Single Cert Renewal
  const handleRenewSingle = async (cert: SslCertificate) => {
    if (!activeConnectionId) return;
    setRenewingCertId(cert.id);
    setMessage(null);
    try {
      const res = await renewCertificates(activeConnectionId, cert.name, false);
      if (res.success) {
        setMessage({ text: `Certificate "${cert.name}" renewed successfully!`, isError: false });
        await refreshAll();
      } else {
        setMessage({ text: `Renewal warning: ${res.output.slice(0, 180)}`, isError: true });
      }
    } catch (err: any) {
      setMessage({ text: `Renewal failed: ${err?.message || err}`, isError: true });
    } finally {
      setRenewingCertId(null);
    }
  };

  // Plugin Selection Handler: Cleanly updates form selection without intrusive popups
  const handleSelectPlugin = (plugin: 'nginx' | 'apache' | 'standalone' | 'webroot' | 'dns') => {
    setIssueForm(prev => ({ ...prev, plugin }));
  };

  // One-click install for missing webserver or plugin triggered from plugin selection
  const handleInstallMissingDep = async () => {
    if (!activeConnectionId || !missingDepModal) return;
    const { type, webserver } = missingDepModal;
    setInstallingComponent(type === 'missing_webserver' ? webserver : `${webserver}-plugin`);

    try {
      if (type === 'missing_webserver') {
        const res = await installWebServer(activeConnectionId, webserver);
        if (res.success) {
          setMessage({ text: `${webserver.toUpperCase()} web server successfully installed!`, isError: false });
          // Check if plugin is also needed
          const newStatus = await detectCertbotStatus(activeConnectionId);
          setCertbotStatus(newStatus);
          if (!newStatus.plugins[webserver]) {
            setMissingDepModal({
              type: 'missing_plugin',
              webserver,
              title: `Install Certbot ${webserver === 'nginx' ? 'Nginx' : 'Apache'} Plugin`,
              description: `${webserver.toUpperCase()} is installed. Now install python3-certbot-${webserver} to complete ACME automated integration.`,
            });
            return;
          }
        } else {
          setMessage({ text: `Failed to install ${webserver}: ${res.output.slice(0, 160)}`, isError: true });
        }
      } else {
        const res = await installCertbotPlugin(activeConnectionId, webserver);
        if (res.success) {
          setMessage({ text: `Certbot ${webserver} plugin installed successfully!`, isError: false });
          const newStatus = await detectCertbotStatus(activeConnectionId);
          setCertbotStatus(newStatus);
        } else {
          setMessage({ text: `Failed to install plugin: ${res.output.slice(0, 160)}`, isError: true });
        }
      }
      setMissingDepModal(null);
    } catch (err: any) {
      setMessage({ text: `Installation error: ${err?.message || err}`, isError: true });
    } finally {
      setInstallingComponent(null);
    }
  };

  // Issue Let's Encrypt Certificate
  const handleIssueSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeConnectionId) return;

    if (!certbotStatus?.installed) {
      setShowInstallAlertModal(true);
      return;
    }

    // Guard: Check if selected plugin has missing webserver dependencies
    if (issueForm.plugin === 'nginx' && certbotStatus && !certbotStatus.webServers.nginx) {
      setMissingDepModal({
        type: 'missing_webserver',
        webserver: 'nginx',
        title: 'Nginx Web Server Is Not Installed',
        description: 'Cannot issue certificate using Nginx plugin because Nginx is not installed on this server. Install Nginx or switch to Standalone mode.',
      });
      return;
    } else if (issueForm.plugin === 'apache' && certbotStatus && !certbotStatus.webServers.apache) {
      setMissingDepModal({
        type: 'missing_webserver',
        webserver: 'apache',
        title: 'Apache Web Server Is Not Installed',
        description: 'Cannot issue certificate using Apache plugin because Apache is not installed on this server. Install Apache or switch to Standalone mode.',
      });
      return;
    }

    setIsIssuing(true);
    setIssueOutput('Contacting Let\'s Encrypt ACME server and verifying domain challenge...\n(This usually takes 10 to 30 seconds)');
    setMessage(null);

    try {
      // 90-second timeout guard to prevent infinite hanging
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Operation timed out after 90 seconds. Please check DNS resolution, firewall port 80/443, and server connectivity.')), 90000)
      );

      const res = await Promise.race([
        issueCertificate(activeConnectionId, issueForm),
        timeoutPromise,
      ]) as { success: boolean; output: string; certName?: string };

      setIssueOutput(res.output);
      if (res.success) {
        setMessage({ text: `SSL Certificate for "${issueForm.domains}" issued successfully!`, isError: false });
        // Refresh certificates in background without freezing the UI
        listCertificates(activeConnectionId).then(certs => setCertificates(certs)).catch(() => {});
      } else {
        setMessage({ text: 'Certificate issuance encountered an issue. Review the diagnostic log below.', isError: true });
      }
    } catch (err: any) {
      setIssueOutput(`Error: ${err?.message || err}`);
      setMessage({ text: `Issuance failed: ${err?.message || err}`, isError: true });
    } finally {
      setIsIssuing(false);
    }
  };

  // Handle Batch Renewal (All)
  const handleRenewAll = async (dryRun: boolean = false) => {
    if (!activeConnectionId) return;
    setIsRenewing(true);
    setRenewalOutput(dryRun ? 'Running Certbot renewal dry-run test...' : 'Executing certbot renew for all certificates...');
    setMessage(null);

    try {
      const res = await renewCertificates(activeConnectionId, undefined, dryRun);
      setRenewalOutput(res.output);
      if (res.success) {
        setMessage({ 
          text: dryRun ? 'Renewal dry-run test completed successfully!' : 'All eligible certificates renewed!', 
          isError: false 
        });
        if (!dryRun) await refreshAll();
      } else {
        setMessage({ text: 'Certbot renewal returned warnings or errors.', isError: true });
      }
    } catch (err: any) {
      setRenewalOutput(`Error: ${err?.message || err}`);
      setMessage({ text: `Renewal failed: ${err?.message || err}`, isError: true });
    } finally {
      setIsRenewing(false);
    }
  };

  // Handle Auto-Renew Timer Activation
  const handleEnableTimer = async () => {
    if (!activeConnectionId) return;
    try {
      const res = await enableAutoRenewTimer(activeConnectionId);
      if (res.success) {
        setMessage({ text: 'Certbot auto-renewal timer enabled & started via systemd!', isError: false });
        await refreshAll();
      } else {
        setMessage({ text: `Failed to enable timer: ${res.output}`, isError: true });
      }
    } catch (err: any) {
      setMessage({ text: `Failed: ${err?.message || err}`, isError: true });
    }
  };

  // Handle Self-Signed Generation (Fast execution with immediate terminal log output)
  const handleGenerateSelfSigned = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeConnectionId) return;
    setIsGeneratingSelfSigned(true);
    setSelfSignedResult(null);
    setMessage(null);

    try {
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('OpenSSL certificate generation timed out after 15 seconds.')), 15000)
      );

      const res = await Promise.race([
        generateSelfSignedCertificate(activeConnectionId, selfSignedForm),
        timeoutPromise,
      ]) as { success: boolean; certPath: string; keyPath: string; output: string };

      setSelfSignedResult(res);

      if (res.success) {
        setMessage({ text: `Self-signed certificate generated successfully at ${res.certPath}!`, isError: false });
        // Background sync to update certificates list without blocking the current tab
        listCertificates(activeConnectionId).then(certs => setCertificates(certs)).catch(() => {});
      } else {
        setMessage({ text: 'OpenSSL generation failed. Review terminal log below.', isError: true });
      }
    } catch (err: any) {
      setSelfSignedResult({
        success: false,
        certPath: '',
        keyPath: '',
        output: String(err?.message || err),
      });
      setMessage({ text: `Error: ${err?.message || err}`, isError: true });
    } finally {
      setIsGeneratingSelfSigned(false);
    }
  };

  // Handle Certificate Deletion / Revocation
  const handleConfirmDelete = async () => {
    if (!activeConnectionId || !certToDelete) return;
    setIsDeleting(true);
    try {
      if (deleteAction === 'revoke') {
        const res = await revokeCertificate(activeConnectionId, certToDelete.name);
        if (res.success) {
          setMessage({ text: `Certificate "${certToDelete.name}" revoked & deleted!`, isError: false });
        } else {
          setMessage({ text: `Revocation failed: ${res.output}`, isError: true });
        }
      } else {
        const res = await deleteCertificate(activeConnectionId, certToDelete.name);
        if (res.success) {
          setMessage({ text: `Certificate "${certToDelete.name}" removed from Certbot!`, isError: false });
        } else {
          setMessage({ text: `Deletion failed: ${res.output}`, isError: true });
        }
      }
      setCertToDelete(null);
      await refreshAll();
    } catch (err: any) {
      setMessage({ text: `Action failed: ${err?.message || err}`, isError: true });
    } finally {
      setIsDeleting(false);
    }
  };

  // Handle SSL Diagnostics Test
  const handleRunDiagnostics = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeConnectionId || !diagDomain.trim()) return;
    setIsTestingDiag(true);
    setDiagResult(null);

    try {
      const res = await testSslDiagnostics(activeConnectionId, diagDomain, diagPort);
      setDiagResult(res);
    } catch (err: any) {
      setDiagResult({
        domain: diagDomain,
        port: diagPort,
        connected: false,
        error: String(err?.message || err),
      });
    } finally {
      setIsTestingDiag(false);
    }
  };

  // Handle Install Certbot (Installs ONLY certbot per requirements)
  const handleInstallCertbot = async () => {
    if (!activeConnectionId) return;
    setIsInstallingCertbot(true);
    setShowInstallAlertModal(true);
    setInstallOutput('Detecting host distribution and running automated package manager install for Certbot core...');
    try {
      const res = await installCertbot(activeConnectionId);
      setInstallOutput(res.output);
      if (res.success) {
        setMessage({ text: 'Certbot successfully installed on server!', isError: false });
        await refreshAll();
      } else {
        setMessage({ text: 'Installation returned non-zero code. Check output log in the modal.', isError: true });
      }
    } catch (err: any) {
      setInstallOutput(`Error: ${err?.message || err}`);
      setMessage({ text: `Installation error: ${err?.message || err}`, isError: true });
    } finally {
      setIsInstallingCertbot(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#14141e] text-[#cdd6f4] select-none font-sans overflow-hidden">
      
      {/* 1. Header Bar */}
      <header className="h-14 border-b border-white/[0.08] bg-[#181825]/90 backdrop-blur-2xl px-5 flex items-center justify-between shrink-0">
        
        {/* Left: App Title & Real-time Certbot Status */}
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-700 flex items-center justify-center text-white shadow-md shadow-emerald-900/30 border border-white/20">
            <ShieldCheck className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-sm font-bold text-white tracking-tight">SSL/TLS Certificate Manager</h1>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                Certbot ACME
              </span>
            </div>
            <div className="text-[11px] text-gray-400 flex items-center space-x-2">
              <span>{activeServer?.username || 'root'}@{activeServer?.host || 'localhost'}</span>
              <span>·</span>
              <span className="flex items-center space-x-1">
                <span className={`w-1.5 h-1.5 rounded-full ${certbotStatus?.installed ? 'bg-emerald-400' : 'bg-rose-400 animate-pulse'}`} />
                {certbotStatus?.installed ? (
                  <span className="text-emerald-300 font-mono">Certbot v{certbotStatus.version || 'installed'}</span>
                ) : (
                  <button
                    onClick={() => setShowInstallAlertModal(true)}
                    className="text-rose-400 hover:text-rose-300 font-medium underline flex items-center space-x-1 cursor-pointer transition-colors"
                    title="Certbot is not installed. Click to view installer."
                  >
                    <span>Certbot Not Installed (Click to Install)</span>
                  </button>
                )}
              </span>
              {certbotStatus?.autoRenewActive && (
                <>
                  <span>·</span>
                  <span className="text-teal-300 flex items-center space-x-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-teal-400 animate-pulse" />
                    <span>Auto-Renew Active</span>
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Right: Primary Quick Action Buttons */}
        <div className="flex items-center space-x-2">
          {!certbotStatus?.installed && (
            <button
              onClick={() => setShowInstallAlertModal(true)}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold shadow-md transition-all cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Install Certbot</span>
            </button>
          )}

          <button
            onClick={() => setActiveTab('issue')}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-md shadow-emerald-900/30 transition-all cursor-pointer active:scale-95"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Issue Let's Encrypt SSL</span>
          </button>

          <button
            onClick={() => handleRenewAll(true)}
            disabled={isRenewing || !activeConnectionId || certificates.length === 0}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/15 text-gray-200 text-xs font-medium border border-white/10 transition-all cursor-pointer disabled:opacity-40"
            title="Test renewals without changing certificates (Dry Run)"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRenewing ? 'animate-spin text-emerald-400' : ''}`} />
            <span>Test Renew (Dry Run)</span>
          </button>

          <button
            onClick={refreshAll}
            disabled={isLoading}
            className="p-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white border border-white/10 transition-colors cursor-pointer"
            title="Refresh certificates and Certbot status"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-emerald-400' : ''}`} />
          </button>
        </div>
      </header>

      {/* Global Notice Banner */}
      {message && (
        <div className={`px-5 py-2.5 text-xs flex items-center space-x-2 border-b shrink-0 ${
          message.isError 
            ? 'bg-rose-500/15 border-rose-500/30 text-rose-300' 
            : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
        }`}>
          {message.isError ? <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" /> : <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />}
          <span className="flex-1 font-mono">{message.text}</span>
          <button onClick={() => setMessage(null)} className="text-gray-400 hover:text-white cursor-pointer">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Top Metric Cards */}
      <div className="grid grid-cols-5 gap-3 p-5 shrink-0">
        <div className="bg-[#181825]/90 border border-white/10 rounded-2xl p-3.5 shadow-md flex items-center justify-between">
          <div>
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Installed Certs</div>
            <div className="text-xl font-bold text-white mt-0.5">{stats.total}</div>
          </div>
          <div className="w-9 h-9 rounded-xl bg-blue-500/15 text-blue-400 flex items-center justify-center border border-blue-500/20">
            <Layers className="w-4 h-4" />
          </div>
        </div>

        <div className="bg-[#181825]/90 border border-white/10 rounded-2xl p-3.5 shadow-md flex items-center justify-between">
          <div>
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Valid & Active</div>
            <div className="text-xl font-bold text-emerald-400 mt-0.5">{stats.valid}</div>
          </div>
          <div className="w-9 h-9 rounded-xl bg-emerald-500/15 text-emerald-400 flex items-center justify-center border border-emerald-500/20">
            <ShieldCheck className="w-4 h-4" />
          </div>
        </div>

        <div className="bg-[#181825]/90 border border-white/10 rounded-2xl p-3.5 shadow-md flex items-center justify-between">
          <div>
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Expiring (&lt; 30d)</div>
            <div className={`text-xl font-bold mt-0.5 ${stats.expiring > 0 ? 'text-amber-400' : 'text-gray-400'}`}>
              {stats.expiring}
            </div>
          </div>
          <div className="w-9 h-9 rounded-xl bg-amber-500/15 text-amber-400 flex items-center justify-center border border-amber-500/20">
            <Clock className="w-4 h-4" />
          </div>
        </div>

        <div className="bg-[#181825]/90 border border-white/10 rounded-2xl p-3.5 shadow-md flex items-center justify-between">
          <div>
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Expired</div>
            <div className={`text-xl font-bold mt-0.5 ${stats.expired > 0 ? 'text-rose-400' : 'text-gray-400'}`}>
              {stats.expired}
            </div>
          </div>
          <div className="w-9 h-9 rounded-xl bg-rose-500/15 text-rose-400 flex items-center justify-center border border-rose-500/20">
            <ShieldAlert className="w-4 h-4" />
          </div>
        </div>

        <div className="bg-[#181825]/90 border border-white/10 rounded-2xl p-3.5 shadow-md flex items-center justify-between">
          <div>
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Auto-Renewal</div>
            <div className="text-xs font-semibold text-white mt-1 flex items-center space-x-1.5">
              <span className={`w-2 h-2 rounded-full ${certbotStatus?.autoRenewActive ? 'bg-emerald-400' : 'bg-gray-500'}`} />
              <span>{certbotStatus?.autoRenewActive ? 'Active (Systemd)' : 'Disabled'}</span>
            </div>
          </div>
          {!certbotStatus?.autoRenewActive && certbotStatus?.installed && (
            <button
              onClick={handleEnableTimer}
              className="text-[10px] font-semibold text-emerald-400 hover:text-emerald-300 bg-emerald-500/10 px-2 py-1 rounded-lg border border-emerald-500/20 cursor-pointer"
            >
              Enable
            </button>
          )}
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="px-5 border-b border-white/[0.08] flex items-center space-x-1 shrink-0 bg-[#14141e]">
        {[
          { id: 'certificates', label: `Certificates (${certificates.length})`, icon: ShieldCheck },
          { id: 'issue', label: 'Issue New SSL', icon: Plus },
          { id: 'renewal', label: 'Auto-Renewal & Cron', icon: Clock },
          { id: 'self-signed', label: 'Self-Signed Generator', icon: KeyRound },
          { id: 'diagnostics', label: 'TLS Handshake Diagnostics', icon: Activity },
        ].map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center space-x-2 px-4 py-2.5 text-xs font-semibold transition-all border-b-2 cursor-pointer ${
                isActive
                  ? 'border-emerald-500 text-white bg-white/5 rounded-t-xl'
                  : 'border-transparent text-gray-400 hover:text-gray-200 hover:bg-white/[0.02]'
              }`}
            >
              <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-emerald-400' : 'text-gray-500'}`} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab Content Area */}
      <div className="flex-1 overflow-y-auto p-5">
        
        {/* TAB 1: CERTIFICATES LIST */}
        {activeTab === 'certificates' && (
          <div className="space-y-4">
            
            {/* Search and Filters Bar */}
            <div className="flex items-center justify-between space-x-3">
              <div className="relative flex-1 max-w-md">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  placeholder="Filter by domain, cert name, or issuer..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full bg-[#181825] border border-white/10 rounded-xl pl-9 pr-3 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500 transition-colors"
                />
              </div>

              <div className="flex items-center space-x-1.5 bg-[#181825] p-1 rounded-xl border border-white/10">
                {(['all', 'valid', 'expiring', 'expired'] as const).map(f => (
                  <button
                    key={f}
                    onClick={() => setStatusFilter(f)}
                    className={`px-3 py-1 rounded-lg text-xs font-medium capitalize transition-colors cursor-pointer ${
                      statusFilter === f 
                        ? 'bg-emerald-600 text-white shadow-sm' 
                        : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    {f === 'expiring' ? 'Expiring Soon' : f}
                  </button>
                ))}
              </div>
            </div>

            {/* Certificates Table / Cards */}
            {isLoading && certificates.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-gray-400 space-y-3">
                <RefreshCw className="w-6 h-6 animate-spin text-emerald-400" />
                <span className="text-xs">Scanning SSL certificates from remote server...</span>
              </div>
            ) : filteredCertificates.length === 0 ? (
              <div className="bg-[#181825]/90 border border-white/10 rounded-2xl p-12 flex flex-col items-center justify-center text-center space-y-3 shadow-xl">
                <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center border border-emerald-500/20">
                  <ShieldCheck className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">No SSL Certificates Found</h3>
                  <p className="text-xs text-gray-400 max-w-sm mt-1">
                    {searchQuery ? 'No certificates matched your search filter.' : 'No active certificates found in /etc/letsencrypt. Click below to issue free Let\'s Encrypt SSL.'}
                  </p>
                </div>
                <button
                  onClick={() => setActiveTab('issue')}
                  className="mt-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-md shadow-emerald-900/30 transition-all cursor-pointer flex items-center space-x-2"
                >
                  <Plus className="w-4 h-4" />
                  <span>Issue New Certificate</span>
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredCertificates.map(cert => {
                  const isExpiring = cert.status === 'expiring_soon';
                  const isExpired = cert.status === 'expired';
                  const isRenewingThis = renewingCertId === cert.id;

                  return (
                    <div
                      key={cert.id}
                      className="bg-[#181825]/90 border border-white/10 hover:border-white/20 rounded-2xl p-4 shadow-xl transition-all backdrop-blur-md flex items-center justify-between"
                    >
                      <div className="space-y-1.5 min-w-0 flex-1 pr-4">
                        <div className="flex items-center space-x-2.5">
                          <span className={`w-2 h-2 rounded-full ${
                            isExpired ? 'bg-rose-400' : isExpiring ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400'
                          }`} />
                          <h3 className="text-sm font-bold text-white font-mono truncate">{cert.name}</h3>

                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold flex items-center space-x-1 ${
                            isExpired
                              ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                              : isExpiring
                              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                              : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                          }`}>
                            <span>
                              {isExpired ? 'Expired' : isExpiring ? `Expires in ${cert.daysRemaining} days` : `Valid (${cert.daysRemaining} days left)`}
                            </span>
                          </span>

                          {cert.isCertbot && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-500/10 text-blue-300 border border-blue-500/20">
                              Let's Encrypt
                            </span>
                          )}

                          {cert.keyType && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-mono text-gray-400 bg-white/5 border border-white/5">
                              {cert.keyType}
                            </span>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-300 font-mono">
                          {cert.domains.map((dom, idx) => (
                            <a
                              key={idx}
                              href={`https://${dom}`}
                              target="_blank"
                              rel="noreferrer"
                              className="bg-white/5 hover:bg-white/10 px-2 py-0.5 rounded border border-white/10 text-sky-300 flex items-center space-x-1 transition-colors"
                              title={`Open https://${dom} in browser`}
                            >
                              <span>{dom}</span>
                              <ExternalLink className="w-2.5 h-2.5 opacity-60" />
                            </a>
                          ))}
                        </div>

                        <div className="flex items-center space-x-4 text-[11px] text-gray-400 pt-1">
                          <span>Expiry: <strong className="text-gray-300">{cert.expiryDate || '—'}</strong></span>
                          <span>·</span>
                          <span className="truncate max-w-xs font-mono text-gray-500" title={cert.certPath}>
                            {cert.certPath}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center space-x-2 shrink-0">
                        {cert.isCertbot && (
                          <button
                            onClick={() => handleRenewSingle(cert)}
                            disabled={isRenewingThis || !activeConnectionId}
                            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 text-xs font-medium transition-colors cursor-pointer disabled:opacity-50"
                            title="Renew this certificate immediately"
                          >
                            <RefreshCw className={`w-3.5 h-3.5 ${isRenewingThis ? 'animate-spin' : ''}`} />
                            <span>{isRenewingThis ? 'Renewing...' : 'Renew'}</span>
                          </button>
                        )}

                        <button
                          onClick={() => handleInspect(cert)}
                          className="flex items-center space-x-1 px-2.5 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white border border-white/10 text-xs transition-colors cursor-pointer"
                          title="Inspect full X.509 certificate details"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>Inspect</span>
                        </button>

                        <button
                          onClick={() => handleViewPem(cert)}
                          className="flex items-center space-x-1 px-2.5 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white border border-white/10 text-xs transition-colors cursor-pointer"
                          title="View public PEM certificate text"
                        >
                          <FileText className="w-3.5 h-3.5" />
                          <span>PEM</span>
                        </button>

                        {cert.isCertbot && (
                          <button
                            onClick={() => {
                              setCertToDelete(cert);
                              setDeleteAction('delete');
                            }}
                            className="p-1.5 rounded-xl hover:bg-rose-500/20 text-gray-400 hover:text-rose-300 transition-colors cursor-pointer"
                            title="Delete or revoke this certificate"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* TAB 2: ISSUE NEW SSL CERTIFICATE WIZARD */}
        {activeTab === 'issue' && (
          <div className="max-w-3xl mx-auto space-y-6">
            <div>
              <h2 className="text-base font-bold text-white tracking-tight">Issue Free SSL/TLS Certificate (Let's Encrypt)</h2>
              <p className="text-xs text-gray-400">
                Automatically request and configure an authorized SSL certificate for your web server domains using Certbot ACME protocol.
              </p>
            </div>

            {!certbotStatus?.installed && (
              <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-200 flex items-center justify-between shadow-xl">
                <div className="flex items-center space-x-3">
                  <ShieldAlert className="w-5 h-5 text-amber-400 shrink-0" />
                  <div>
                    <h4 className="text-xs font-bold text-white">Certbot Application Required</h4>
                    <p className="text-[11px] text-amber-300/80">
                      Certbot is not installed on this server. Click &quot;Install Certbot&quot; below to install Certbot core.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowInstallAlertModal(true)}
                  className="px-3.5 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold shadow-md cursor-pointer flex items-center space-x-1.5 shrink-0"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Install Certbot</span>
                </button>
              </div>
            )}

            <form onSubmit={handleIssueSubmit} className="space-y-4">
              
              {/* Domain Names */}
              <div className="bg-[#181825]/90 border border-white/10 rounded-2xl p-4 space-y-2 shadow-xl backdrop-blur-md">
                <label className="block text-xs font-semibold text-white">
                  Domain Names (SANs) <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. example.com, www.example.com, api.example.com"
                  value={issueForm.domains}
                  onChange={e => setIssueForm({ ...issueForm, domains: e.target.value })}
                  className="w-full bg-[#101018] border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white font-mono placeholder-gray-500 focus:outline-none focus:border-emerald-500 transition-colors"
                />
                <p className="text-[11px] text-gray-400">
                  Separate multiple domains with commas or spaces. First domain will be used as the primary Common Name (CN).
                </p>
              </div>

              {/* Email Address */}
              <div className="bg-[#181825]/90 border border-white/10 rounded-2xl p-4 space-y-2 shadow-xl backdrop-blur-md">
                <label className="block text-xs font-semibold text-white">
                  Administrator Email Address
                </label>
                <input
                  type="email"
                  placeholder="admin@yourdomain.com (recommended for urgent renewal alerts)"
                  value={issueForm.email}
                  onChange={e => setIssueForm({ ...issueForm, email: e.target.value })}
                  className="w-full bg-[#101018] border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500 transition-colors"
                />
              </div>

              {/* Web Server / Challenge Method Selection */}
              <div className="bg-[#181825]/90 border border-white/10 rounded-2xl p-4 space-y-3 shadow-xl backdrop-blur-md">
                <label className="block text-xs font-semibold text-white">
                  Web Server &amp; Challenge Method
                </label>
                <div className="grid grid-cols-3 gap-2.5">
                  {[
                    { id: 'nginx', label: 'Nginx Plugin', desc: 'Auto-edits Nginx vhosts & handles challenge' },
                    { id: 'apache', label: 'Apache Plugin', desc: 'Auto-edits Apache virtual hosts' },
                    { id: 'standalone', label: 'Standalone', desc: 'Temporarily listens on port 80' },
                    { id: 'webroot', label: 'Webroot', desc: 'Places challenge in existing doc root' },
                    { id: 'dns', label: 'DNS Challenge', desc: 'Manual TXT record verification' },
                  ].map(m => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => handleSelectPlugin(m.id as any)}
                      className={`p-3 rounded-xl border text-left cursor-pointer transition-all ${
                        issueForm.plugin === m.id
                          ? 'bg-emerald-600/20 border-emerald-500 text-white shadow-sm'
                          : 'bg-white/5 border-white/10 text-gray-400 hover:text-white hover:bg-white/10'
                      }`}
                    >
                      <div className="text-xs font-bold flex items-center justify-between">
                        <span>{m.label}</span>
                        {m.id === 'nginx' && certbotStatus?.webServers.nginx && (
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" title="Nginx detected on host" />
                        )}
                        {m.id === 'apache' && certbotStatus?.webServers.apache && (
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" title="Apache detected on host" />
                        )}
                      </div>
                      <div className="text-[10px] text-gray-400 mt-0.5 leading-snug">{m.desc}</div>
                    </button>
                  ))}
                </div>

                {/* Inline Dependency Alert / Status for Nginx / Apache */}
                {issueForm.plugin === 'nginx' && certbotStatus && (
                  !certbotStatus.webServers.nginx ? (
                    <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/25 flex items-center justify-between text-xs text-amber-200">
                      <div className="flex items-center space-x-2">
                        <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                        <span>Nginx is not detected on this server.</span>
                      </div>
                      <div className="flex items-center space-x-2">
                        <button
                          type="button"
                          onClick={() => setIssueForm(prev => ({ ...prev, plugin: 'standalone' }))}
                          className="px-2 py-1 rounded bg-white/10 hover:bg-white/15 text-[11px] text-gray-300 cursor-pointer"
                        >
                          Use Standalone
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setMissingDepModal({
                              type: 'missing_webserver',
                              webserver: 'nginx',
                              title: 'Install Nginx Web Server',
                              description: 'Install Nginx on this server to enable automatic Nginx SSL configuration.',
                            });
                          }}
                          className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-[11px] text-white font-semibold cursor-pointer"
                        >
                          Install Nginx
                        </button>
                      </div>
                    </div>
                  ) : !certbotStatus.plugins.nginx ? (
                    <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/25 flex items-center justify-between text-xs text-blue-200">
                      <div className="flex items-center space-x-2">
                        <Info className="w-4 h-4 text-blue-400 shrink-0" />
                        <span>Nginx is installed, but the Certbot Nginx plugin (python3-certbot-nginx) is not installed.</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setMissingDepModal({
                            type: 'missing_plugin',
                            webserver: 'nginx',
                            title: 'Install Certbot Nginx Plugin',
                            description: 'Install python3-certbot-nginx so Certbot can configure Nginx virtual hosts.',
                          });
                        }}
                        className="px-2.5 py-1 rounded bg-blue-600 hover:bg-blue-500 text-[11px] text-white font-semibold cursor-pointer shrink-0"
                      >
                        Install Nginx Plugin
                      </button>
                    </div>
                  ) : (
                    <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/25 flex items-center space-x-2 text-xs text-emerald-300">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                      <span>Nginx web server and Certbot Nginx plugin are detected &amp; ready for automated configuration.</span>
                    </div>
                  )
                )}

                {issueForm.plugin === 'apache' && certbotStatus && (
                  !certbotStatus.webServers.apache ? (
                    <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/25 flex items-center justify-between text-xs text-amber-200">
                      <div className="flex items-center space-x-2">
                        <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                        <span>Apache is not detected on this server.</span>
                      </div>
                      <div className="flex items-center space-x-2">
                        <button
                          type="button"
                          onClick={() => setIssueForm(prev => ({ ...prev, plugin: 'standalone' }))}
                          className="px-2 py-1 rounded bg-white/10 hover:bg-white/15 text-[11px] text-gray-300 cursor-pointer"
                        >
                          Use Standalone
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setMissingDepModal({
                              type: 'missing_webserver',
                              webserver: 'apache',
                              title: 'Install Apache Web Server',
                              description: 'Install Apache on this server to enable automatic Apache SSL configuration.',
                            });
                          }}
                          className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-[11px] text-white font-semibold cursor-pointer"
                        >
                          Install Apache
                        </button>
                      </div>
                    </div>
                  ) : !certbotStatus.plugins.apache ? (
                    <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/25 flex items-center justify-between text-xs text-blue-200">
                      <div className="flex items-center space-x-2">
                        <Info className="w-4 h-4 text-blue-400 shrink-0" />
                        <span>Apache is installed, but the Certbot Apache plugin (python3-certbot-apache) is not installed.</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setMissingDepModal({
                            type: 'missing_plugin',
                            webserver: 'apache',
                            title: 'Install Certbot Apache Plugin',
                            description: 'Install python3-certbot-apache so Certbot can configure Apache virtual hosts.',
                          });
                        }}
                        className="px-2.5 py-1 rounded bg-blue-600 hover:bg-blue-500 text-[11px] text-white font-semibold cursor-pointer shrink-0"
                      >
                        Install Apache Plugin
                      </button>
                    </div>
                  ) : (
                    <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/25 flex items-center space-x-2 text-xs text-emerald-300">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                      <span>Apache web server and Certbot Apache plugin are detected &amp; ready for automated configuration.</span>
                    </div>
                  )
                )}

                {issueForm.plugin === 'webroot' && (
                  <div className="pt-2">
                    <label className="block text-[11px] font-medium text-gray-300 mb-1">Document Root Path</label>
                    <input
                      type="text"
                      value={issueForm.webrootPath}
                      onChange={e => setIssueForm({ ...issueForm, webrootPath: e.target.value })}
                      placeholder="/var/www/html"
                      className="w-full bg-[#101018] border border-white/10 rounded-xl px-3 py-1.5 text-xs text-white font-mono"
                    />
                  </div>
                )}
              </div>

              {/* Advanced Options */}
              <div className="bg-[#181825]/90 border border-white/10 rounded-2xl p-4 space-y-3 shadow-xl backdrop-blur-md">
                <span className="text-xs font-semibold text-white block">Certificate Security &amp; Options</span>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[11px] text-gray-400 mb-1">Key Algorithm</label>
                    <select
                      value={issueForm.keyType}
                      onChange={e => setIssueForm({ ...issueForm, keyType: e.target.value as any })}
                      className="w-full bg-[#101018] border border-white/10 rounded-xl px-3 py-1.5 text-xs text-white"
                    >
                      <option value="ecdsa">ECDSA (Faster, Modern, secp384r1) - Recommended</option>
                      <option value="rsa">RSA (Legacy Compatible)</option>
                    </select>
                  </div>

                  {issueForm.keyType === 'rsa' && (
                    <div>
                      <label className="block text-[11px] text-gray-400 mb-1">RSA Key Size</label>
                      <select
                        value={issueForm.rsaKeySize}
                        onChange={e => setIssueForm({ ...issueForm, rsaKeySize: Number(e.target.value) as any })}
                        className="w-full bg-[#101018] border border-white/10 rounded-xl px-3 py-1.5 text-xs text-white font-mono"
                      >
                        <option value={2048}>2048-bit (Standard)</option>
                        <option value={4096}>4096-bit (High Security)</option>
                      </select>
                    </div>
                  )}
                </div>

                <div className="pt-1 space-y-2">
                  <label className="flex items-center space-x-2 text-xs text-gray-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={issueForm.redirectHttps}
                      onChange={e => setIssueForm({ ...issueForm, redirectHttps: e.target.checked })}
                      className="rounded bg-white/10 border-white/20 text-emerald-600 focus:ring-0"
                    />
                    <span>Automatic HTTP to HTTPS Redirection in Web Server config</span>
                  </label>

                  <label className="flex items-center space-x-2 text-xs text-gray-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={issueForm.dryRun}
                      onChange={e => setIssueForm({ ...issueForm, dryRun: e.target.checked })}
                      className="rounded bg-white/10 border-white/20 text-amber-500 focus:ring-0"
                    />
                    <span className="text-amber-300">
                      Dry-Run Test Mode (--dry-run) · Tests ACME challenge without using Let's Encrypt rate limits
                    </span>
                  </label>
                </div>
              </div>

              {/* Submit Button */}
              <div className="flex items-center justify-end space-x-3">
                <button
                  type="submit"
                  disabled={isIssuing || !activeConnectionId || !issueForm.domains.trim()}
                  className="flex items-center space-x-2 px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-lg shadow-emerald-900/30 transition-all cursor-pointer disabled:opacity-50"
                >
                  {isIssuing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                  <span>{isIssuing ? 'Issuing Certificate...' : issueForm.dryRun ? 'Run Test Issuance' : 'Issue SSL Certificate'}</span>
                </button>
              </div>
            </form>

            {/* Issuance Terminal Output Log */}
            {issueOutput && (
              <div className="bg-[#101018] border border-white/10 rounded-2xl p-4 space-y-2 shadow-2xl">
                <div className="flex items-center justify-between text-xs font-mono text-gray-400 border-b border-white/5 pb-2">
                  <div className="flex items-center space-x-2">
                    <Terminal className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Certbot ACME Output Log</span>
                  </div>
                  {isIssuing && <span className="text-emerald-400 animate-pulse">Running ACME challenge...</span>}
                </div>
                <pre className="text-[11px] font-mono text-gray-300 whitespace-pre-wrap max-h-60 overflow-y-auto select-text leading-relaxed">
                  {issueOutput}
                </pre>
              </div>
            )}
          </div>
        )}

        {/* TAB 3: AUTO-RENEWAL & CRON */}
        {activeTab === 'renewal' && (
          <div className="max-w-2xl mx-auto space-y-5">
            <div>
              <h2 className="text-base font-bold text-white tracking-tight">Certbot Auto-Renewal &amp; Systemd Timers</h2>
              <p className="text-xs text-gray-400">
                Let's Encrypt certificates are valid for 90 days. Certbot automatically renews certificates when they have less than 30 days remaining.
              </p>
            </div>

            {!certbotStatus?.installed && (
              <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-200 flex items-center justify-between shadow-xl">
                <div className="flex items-center space-x-3">
                  <ShieldAlert className="w-5 h-5 text-amber-400 shrink-0" />
                  <div>
                    <h4 className="text-xs font-bold text-white">Certbot Application Required</h4>
                    <p className="text-[11px] text-amber-300/80">
                      Certbot systemd timers and auto-renewal checks require Certbot installed on this server.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowInstallAlertModal(true)}
                  className="px-3.5 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold shadow-md cursor-pointer flex items-center space-x-1.5 shrink-0"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Install Certbot</span>
                </button>
              </div>
            )}

            <div className="bg-[#181825]/90 border border-white/10 rounded-2xl p-5 shadow-xl backdrop-blur-md space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 rounded-xl bg-teal-500/15 text-teal-400 flex items-center justify-center border border-teal-500/20">
                    <Clock className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-xs font-bold text-white">systemd: certbot.timer</h3>
                    <div className="text-[11px] text-gray-400 mt-0.5">
                      Runs twice daily to renew any expiring certificates automatically.
                    </div>
                  </div>
                </div>

                <span className={`px-2.5 py-1 rounded-full text-xs font-bold flex items-center space-x-1.5 ${
                  certbotStatus?.autoRenewActive
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                    : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                }`}>
                  <span className={`w-2 h-2 rounded-full ${certbotStatus?.autoRenewActive ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'}`} />
                  <span>{certbotStatus?.autoRenewActive ? 'Active' : 'Inactive'}</span>
                </span>
              </div>

              <div className="pt-2 flex items-center space-x-3">
                <button
                  onClick={handleEnableTimer}
                  disabled={!activeConnectionId}
                  className="px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-semibold shadow-md transition-all cursor-pointer"
                >
                  Enable &amp; Start certbot.timer
                </button>

                <button
                  onClick={() => handleRenewAll(true)}
                  disabled={isRenewing || !activeConnectionId}
                  className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-gray-200 text-xs font-semibold border border-white/10 transition-all cursor-pointer"
                >
                  Test Renewal (Dry-Run)
                </button>

                <button
                  onClick={() => handleRenewAll(false)}
                  disabled={isRenewing || !activeConnectionId}
                  className="px-4 py-2 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 text-xs font-semibold transition-all cursor-pointer"
                >
                  Force Renew All
                </button>
              </div>
            </div>

            {renewalOutput && (
              <div className="bg-[#101018] border border-white/10 rounded-2xl p-4 space-y-2 shadow-2xl">
                <div className="flex items-center justify-between text-xs font-mono text-gray-400 border-b border-white/5 pb-2">
                  <span>Certbot Renewal Execution Output</span>
                  {isRenewing && <span className="text-emerald-400 animate-pulse">Processing...</span>}
                </div>
                <pre className="text-[11px] font-mono text-gray-300 whitespace-pre-wrap max-h-60 overflow-y-auto select-text">
                  {renewalOutput}
                </pre>
              </div>
            )}
          </div>
        )}

        {/* TAB 4: SELF-SIGNED GENERATOR (FIXED: -batch flag prevents loading hang) */}
        {activeTab === 'self-signed' && (
          <div className="max-w-2xl mx-auto space-y-6">
            <div>
              <h2 className="text-base font-bold text-white tracking-tight">Generate Self-Signed SSL/TLS Certificate</h2>
              <p className="text-xs text-gray-400">
                Quickly create OpenSSL private keys and self-signed certificates for local development, test APIs, or staging servers without ACME.
              </p>
            </div>

            <form onSubmit={handleGenerateSelfSigned} className="bg-[#181825]/90 border border-white/10 rounded-2xl p-5 space-y-4 shadow-xl backdrop-blur-md">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-white mb-1">Common Name / Domain *</label>
                  <input
                    type="text"
                    required
                    value={selfSignedForm.domain}
                    onChange={e => setSelfSignedForm({ ...selfSignedForm, domain: e.target.value })}
                    placeholder="localhost or dev.local"
                    className="w-full bg-[#101018] border border-white/10 rounded-xl px-3 py-2 text-xs text-white font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-white mb-1">Organization</label>
                  <input
                    type="text"
                    value={selfSignedForm.organization}
                    onChange={e => setSelfSignedForm({ ...selfSignedForm, organization: e.target.value })}
                    placeholder="Development Corp"
                    className="w-full bg-[#101018] border border-white/10 rounded-xl px-3 py-2 text-xs text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-white mb-1">Country Code (2 letters)</label>
                  <input
                    type="text"
                    maxLength={2}
                    value={selfSignedForm.country}
                    onChange={e => setSelfSignedForm({ ...selfSignedForm, country: e.target.value.toUpperCase() })}
                    placeholder="US"
                    className="w-full bg-[#101018] border border-white/10 rounded-xl px-3 py-2 text-xs text-white uppercase font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-white mb-1">Validity (Days)</label>
                  <select
                    value={selfSignedForm.validDays}
                    onChange={e => setSelfSignedForm({ ...selfSignedForm, validDays: Number(e.target.value) })}
                    className="w-full bg-[#101018] border border-white/10 rounded-xl px-3 py-2 text-xs text-white font-mono"
                  >
                    <option value={30}>30 Days</option>
                    <option value={90}>90 Days</option>
                    <option value={365}>365 Days (1 Year)</option>
                    <option value={730}>730 Days (2 Years)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-white mb-1">Output Directory</label>
                  <input
                    type="text"
                    value={selfSignedForm.outputDir}
                    onChange={e => setSelfSignedForm({ ...selfSignedForm, outputDir: e.target.value })}
                    placeholder="/etc/ssl/certs"
                    className="w-full bg-[#101018] border border-white/10 rounded-xl px-3 py-2 text-xs text-white font-mono"
                  />
                </div>
              </div>

              <div className="pt-2 flex justify-end">
                <button
                  type="submit"
                  disabled={isGeneratingSelfSigned || !activeConnectionId}
                  className="flex items-center space-x-2 px-5 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold shadow-md shadow-purple-900/30 transition-all cursor-pointer disabled:opacity-50"
                >
                  {isGeneratingSelfSigned ? <RefreshCw className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
                  <span>{isGeneratingSelfSigned ? 'Generating with OpenSSL...' : 'Generate Self-Signed Cert'}</span>
                </button>
              </div>
            </form>

            {/* Dedicated Self-Signed Result Output Console */}
            {selfSignedResult && (
              <div className={`rounded-2xl border p-5 shadow-2xl space-y-4 backdrop-blur-md animate-in fade-in duration-200 ${
                selfSignedResult.success 
                  ? 'bg-emerald-950/20 border-emerald-500/30' 
                  : 'bg-rose-950/20 border-rose-500/30'
              }`}>
                {/* Result Header */}
                <div className="flex items-center justify-between pb-3 border-b border-white/10">
                  <div className="flex items-center space-x-2.5">
                    {selfSignedResult.success ? (
                      <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                    ) : (
                      <AlertCircle className="w-5 h-5 text-rose-400" />
                    )}
                    <div>
                      <h4 className="text-sm font-bold text-white">
                        {selfSignedResult.success 
                          ? 'Self-Signed Certificate Generated Successfully' 
                          : 'OpenSSL Generation Failed'}
                      </h4>
                      <p className="text-[11px] text-gray-400">
                        {selfSignedResult.success 
                          ? 'RSA 2048-bit key and X.509 certificate were created on the server disk.' 
                          : 'Review the OpenSSL diagnostic error output below.'}
                      </p>
                    </div>
                  </div>

                  {selfSignedResult.success && (
                    <button
                      type="button"
                      onClick={() => setActiveTab('certificates')}
                      className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-md transition-all cursor-pointer"
                    >
                      <Layers className="w-3.5 h-3.5" />
                      <span>View in Certificate List</span>
                    </button>
                  )}
                </div>

                {/* Generated File Paths */}
                {selfSignedResult.success && (
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="p-3 rounded-xl bg-black/40 border border-white/5 space-y-1">
                      <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Public Certificate (.crt)</div>
                      <div className="flex items-center justify-between">
                        <code className="text-emerald-300 font-mono text-[11px] truncate select-all">{selfSignedResult.certPath}</code>
                        <button
                          type="button"
                          onClick={() => navigator.clipboard.writeText(selfSignedResult.certPath)}
                          className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-white cursor-pointer ml-1"
                          title="Copy certificate path"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="p-3 rounded-xl bg-black/40 border border-white/5 space-y-1">
                      <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Private Key (.key)</div>
                      <div className="flex items-center justify-between">
                        <code className="text-purple-300 font-mono text-[11px] truncate select-all">{selfSignedResult.keyPath}</code>
                        <button
                          type="button"
                          onClick={() => navigator.clipboard.writeText(selfSignedResult.keyPath)}
                          className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-white cursor-pointer ml-1"
                          title="Copy private key path"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* OpenSSL Terminal Output Box */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-gray-300 flex items-center space-x-1.5">
                      <Terminal className="w-3.5 h-3.5 text-purple-400" />
                      <span>OpenSSL Console Output</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => navigator.clipboard.writeText(selfSignedResult.output)}
                      className="text-[11px] text-gray-400 hover:text-white flex items-center space-x-1 cursor-pointer"
                    >
                      <Copy className="w-3 h-3" />
                      <span>Copy Output</span>
                    </button>
                  </div>
                  <pre className={`p-3.5 rounded-xl text-xs font-mono whitespace-pre-wrap break-all border overflow-y-auto max-h-60 leading-relaxed select-text ${
                    selfSignedResult.success 
                      ? 'bg-black/70 border-white/10 text-emerald-300' 
                      : 'bg-rose-950/40 border-rose-500/30 text-rose-300'
                  }`}>
                    {selfSignedResult.output || '(No command output recorded)'}
                  </pre>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 5: TLS HANDSHAKE DIAGNOSTICS */}
        {activeTab === 'diagnostics' && (
          <div className="max-w-3xl mx-auto space-y-6">
            <div>
              <h2 className="text-base font-bold text-white tracking-tight">TLS Handshake &amp; SSL Health Diagnostics</h2>
              <p className="text-xs text-gray-400">
                Perform an active TLS probe via OpenSSL against any domain or localhost port 443 to inspect negotiated protocols, cipher suites, and certificate chains.
              </p>
            </div>

            <form onSubmit={handleRunDiagnostics} className="bg-[#181825]/90 border border-white/10 rounded-2xl p-4 space-y-3 shadow-xl backdrop-blur-md">
              <div className="grid grid-cols-4 gap-3">
                <div className="col-span-3">
                  <label className="block text-xs font-semibold text-white mb-1">Target Host / Domain</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. example.com or 127.0.0.1"
                    value={diagDomain}
                    onChange={e => setDiagDomain(e.target.value)}
                    className="w-full bg-[#101018] border border-white/10 rounded-xl px-3 py-2 text-xs text-white font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-white mb-1">Port</label>
                  <input
                    type="number"
                    min={1}
                    max={65535}
                    value={diagPort}
                    onChange={e => setDiagPort(Number(e.target.value))}
                    className="w-full bg-[#101018] border border-white/10 rounded-xl px-3 py-2 text-xs text-white font-mono"
                  />
                </div>
              </div>

              <div className="flex justify-end pt-1">
                <button
                  type="submit"
                  disabled={isTestingDiag || !activeConnectionId || !diagDomain.trim()}
                  className="flex items-center space-x-2 px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-md transition-all cursor-pointer disabled:opacity-50"
                >
                  {isTestingDiag ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Activity className="w-3.5 h-3.5" />}
                  <span>{isTestingDiag ? 'Probing SSL Port...' : 'Run TLS Handshake Test'}</span>
                </button>
              </div>
            </form>

            {/* Diagnostic Results Card */}
            {diagResult && (
              <div className="bg-[#181825]/90 border border-white/10 rounded-2xl p-5 space-y-4 shadow-xl backdrop-blur-md">
                <div className="flex items-center justify-between border-b border-white/10 pb-3">
                  <div className="flex items-center space-x-2">
                    <span className={`w-2.5 h-2.5 rounded-full ${diagResult.connected ? 'bg-emerald-400' : 'bg-rose-400'}`} />
                    <h3 className="text-sm font-bold text-white font-mono">{diagResult.domain}:{diagResult.port}</h3>
                  </div>
                  <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                    diagResult.connected 
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' 
                      : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                  }`}>
                    {diagResult.connected ? 'TLS Handshake Succeeded' : 'Handshake Failed'}
                  </span>
                </div>

                {diagResult.connected ? (
                  <div className="grid grid-cols-2 gap-4 text-xs font-mono">
                    <div className="bg-[#101018] p-3 rounded-xl border border-white/5 space-y-1.5">
                      <div className="text-gray-400 text-[10px] uppercase font-bold">Negotiated Security</div>
                      <div className="text-white">Protocol: <span className="text-emerald-400 font-bold">{diagResult.protocol || 'TLS'}</span></div>
                      <div className="text-white">Cipher: <span className="text-sky-300 text-[11px] truncate block">{diagResult.cipher || '—'}</span></div>
                    </div>

                    {diagResult.serverCertificate && (
                      <div className="bg-[#101018] p-3 rounded-xl border border-white/5 space-y-1.5">
                        <div className="text-gray-400 text-[10px] uppercase font-bold">Served Certificate</div>
                        <div className="text-white truncate">Subject: <span className="text-emerald-300">{diagResult.serverCertificate.subject}</span></div>
                        <div className="text-white truncate">Issuer: <span className="text-purple-300">{diagResult.serverCertificate.issuer}</span></div>
                        <div className="text-white">Expires: <span className="text-amber-300">{diagResult.serverCertificate.validTo}</span></div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-xs text-rose-300 font-mono bg-rose-500/10 p-3 rounded-xl border border-rose-500/20">
                    {diagResult.error || 'Port 443 is closed or refused connection. Ensure web server (Nginx/Apache) is running and firewall port 443 is open.'}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* MODAL 1: Inspect Certificate (X.509) */}
      {selectedCertForInspect && (
        <div 
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex items-center justify-center p-6 animate-in fade-in"
          onClick={() => setSelectedCertForInspect(null)}
        >
          <div 
            className="bg-[#181825] border border-white/20 rounded-3xl w-full max-w-2xl p-6 shadow-2xl space-y-4 max-h-[85vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center space-x-2.5">
                <ShieldCheck className="w-5 h-5 text-emerald-400" />
                <h3 className="text-sm font-bold text-white font-mono">
                  {selectedCertForInspect.name} (X.509 Certificate)
                </h3>
              </div>
              <button
                onClick={() => setSelectedCertForInspect(null)}
                className="text-gray-400 hover:text-white cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto bg-[#101018] p-4 rounded-2xl border border-white/5 font-mono text-xs text-gray-300 select-text leading-relaxed">
              <pre className="whitespace-pre-wrap">{inspectDetails}</pre>
            </div>

            <div className="flex justify-end pt-1">
              <button
                onClick={() => setSelectedCertForInspect(null)}
                className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: View Public PEM Content */}
      {selectedCertForPem && (
        <div 
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex items-center justify-center p-6 animate-in fade-in"
          onClick={() => setSelectedCertForPem(null)}
        >
          <div 
            className="bg-[#181825] border border-white/20 rounded-3xl w-full max-w-xl p-6 shadow-2xl space-y-4 max-h-[85vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center space-x-2">
                <FileText className="w-5 h-5 text-blue-400" />
                <h3 className="text-sm font-bold text-white font-mono">{selectedCertForPem.name} (fullchain.pem)</h3>
              </div>
              <button
                onClick={() => setSelectedCertForPem(null)}
                className="text-gray-400 hover:text-white cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto bg-[#101018] p-4 rounded-2xl border border-white/5 font-mono text-[11px] text-gray-300 select-text leading-relaxed">
              <pre className="whitespace-pre-wrap">{pemContent}</pre>
            </div>

            <div className="flex items-center justify-between pt-1">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(pemContent);
                  setCopiedPem(true);
                  setTimeout(() => setCopiedPem(false), 2000);
                }}
                className="flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-md cursor-pointer"
              >
                {copiedPem ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedPem ? 'Copied PEM to Clipboard!' : 'Copy PEM Content'}</span>
              </button>

              <button
                onClick={() => setSelectedCertForPem(null)}
                className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: Delete / Revoke Confirmation */}
      {certToDelete && (
        <div 
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-center justify-center p-6 animate-in fade-in"
          onClick={() => setCertToDelete(null)}
        >
          <div 
            className="bg-[#181825] border border-white/20 rounded-3xl w-full max-w-md p-6 shadow-2xl space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center space-x-3 text-rose-400">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <h3 className="text-base font-bold text-white">Delete or Revoke Certificate</h3>
            </div>

            <p className="text-xs text-gray-300 leading-relaxed">
              Are you sure you want to remove certificate <strong className="text-white font-mono">{certToDelete.name}</strong> from Certbot?
            </p>

            <div className="space-y-2 pt-1">
              <label className="flex items-center space-x-2 text-xs text-gray-300 cursor-pointer">
                <input
                  type="radio"
                  name="delAction"
                  checked={deleteAction === 'delete'}
                  onChange={() => setDeleteAction('delete')}
                  className="text-rose-500"
                />
                <span>Delete local certificate and renewal configuration files only</span>
              </label>

              <label className="flex items-center space-x-2 text-xs text-gray-300 cursor-pointer">
                <input
                  type="radio"
                  name="delAction"
                  checked={deleteAction === 'revoke'}
                  onChange={() => setDeleteAction('revoke')}
                  className="text-rose-500"
                />
                <span className="text-rose-300">
                  Revoke with Let's Encrypt ACME server and delete files
                </span>
              </label>
            </div>

            <div className="flex items-center justify-end space-x-2.5 pt-3 border-t border-white/10">
              <button
                onClick={() => setCertToDelete(null)}
                className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDelete}
                disabled={isDeleting}
                className="flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold shadow-md shadow-rose-900/30 cursor-pointer disabled:opacity-50"
              >
                {isDeleting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                <span>{isDeleting ? 'Processing...' : deleteAction === 'revoke' ? 'Revoke & Delete' : 'Delete Certificate'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 4: Target Web Server / Plugin Missing Modal (Only asked when user selects that webserver) */}
      {missingDepModal && (
        <div 
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200"
          onClick={() => !installingComponent && setMissingDepModal(null)}
        >
          <div 
            className="bg-[#181825] border border-amber-500/30 rounded-3xl w-full max-w-lg p-6 shadow-2xl space-y-4 animate-in zoom-in-95 duration-200"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start justify-between border-b border-white/10 pb-3">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center border border-amber-500/30 shrink-0">
                  <Wrench className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">{missingDepModal.title}</h3>
                  <div className="text-[11px] text-amber-300 font-mono mt-0.5">
                    Target: {missingDepModal.webserver.toUpperCase()} · Mode: {missingDepModal.type === 'missing_webserver' ? 'Package Missing' : 'Plugin Missing'}
                  </div>
                </div>
              </div>
              {!installingComponent && (
                <button
                  onClick={() => setMissingDepModal(null)}
                  className="text-gray-400 hover:text-white cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            <p className="text-xs text-gray-300 leading-relaxed">
              {missingDepModal.description}
            </p>

            <div className="p-3 bg-[#101018] rounded-xl border border-white/5 text-[11px] text-gray-400 font-mono space-y-1">
              <div>Detected OS: <span className="text-white">{certbotStatus?.osName || 'Linux'}</span></div>
              <div>
                Package to install: <span className="text-emerald-400 font-bold">
                  {missingDepModal.type === 'missing_webserver' 
                    ? missingDepModal.webserver === 'nginx' ? 'nginx' : 'apache2 / httpd' 
                    : `python3-certbot-${missingDepModal.webserver}`}
                </span>
              </div>
            </div>

            {installingComponent && (
              <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-xl flex items-center space-x-2 text-xs text-blue-300 font-mono animate-pulse">
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Installing {installingComponent} on remote host...</span>
              </div>
            )}

            <div className="flex items-center justify-between pt-2 border-t border-white/10">
              <button
                type="button"
                onClick={() => {
                  setIssueForm(prev => ({ ...prev, plugin: 'standalone' }));
                  setMissingDepModal(null);
                }}
                disabled={!!installingComponent}
                className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/15 text-gray-300 text-xs font-medium cursor-pointer"
              >
                Switch to Standalone Mode
              </button>

              <button
                type="button"
                onClick={handleInstallMissingDep}
                disabled={!!installingComponent || (!hasSudo && !isRoot)}
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-md shadow-emerald-900/30 flex items-center space-x-1.5 cursor-pointer disabled:opacity-50"
              >
                {installingComponent ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                <span>
                  {installingComponent 
                    ? 'Installing...' 
                    : missingDepModal.type === 'missing_webserver' 
                    ? `Install ${missingDepModal.webserver.toUpperCase()}` 
                    : `Install ${missingDepModal.webserver.toUpperCase()} Plugin`}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 5: Certbot Core Installer Modal */}
      {showInstallAlertModal && (
        <div 
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200"
          onClick={() => !isInstallingCertbot && setShowInstallAlertModal(false)}
        >
          <div 
            className="bg-[#181825] border border-amber-500/30 rounded-3xl w-full max-w-xl p-6 shadow-2xl space-y-4 max-h-[90vh] flex flex-col animate-in zoom-in-95 duration-200"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start justify-between border-b border-white/10 pb-4">
              <div className="flex items-center space-x-3">
                <div className="w-12 h-12 rounded-2xl bg-amber-500/20 text-amber-400 flex items-center justify-center border border-amber-500/30 shrink-0 shadow-lg shadow-amber-500/10">
                  <ShieldAlert className="w-6 h-6 animate-pulse" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white flex items-center space-x-2">
                    <span>Certbot ACME Client Installation</span>
                  </h3>
                  <div className="text-xs text-amber-300/90 font-mono mt-0.5">
                    {activeServer?.username || 'root'}@{activeServer?.host || 'remote'} · {certbotStatus?.osName || 'Linux Host'}
                  </div>
                </div>
              </div>
              {!isInstallingCertbot && (
                <button
                  onClick={() => setShowInstallAlertModal(false)}
                  className="text-gray-400 hover:text-white p-1 rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            <div className="space-y-3 flex-1 overflow-y-auto pr-1">
              <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-200 leading-relaxed">
                <p>
                  <strong>Notice:</strong> This automated installer will install <strong>Certbot core</strong> on your remote server. Web server plugins (such as Nginx or Apache) are only installed when you select those specific modes in the wizard.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                <div className="bg-[#101018] p-2.5 rounded-xl border border-white/5 space-y-0.5">
                  <span className="text-gray-500 text-[10px] uppercase font-bold block">Operating System</span>
                  <span className="text-white font-medium truncate block">{certbotStatus?.osName || 'Linux Host'}</span>
                </div>
                <div className="bg-[#101018] p-2.5 rounded-xl border border-white/5 space-y-0.5">
                  <span className="text-gray-500 text-[10px] uppercase font-bold block">Package Manager</span>
                  <span className="text-emerald-400 font-medium truncate block">{certbotStatus?.packageManager || 'apt / dnf'}</span>
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[11px] text-gray-400">
                  <span>Installation Command (Certbot only)</span>
                  {copiedInstallCmd ? (
                    <span className="text-emerald-400 flex items-center space-x-1">
                      <Check className="w-3 h-3" />
                      <span>Copied to clipboard</span>
                    </span>
                  ) : (
                    <button
                      onClick={() => {
                        const cmd = certbotStatus?.suggestedCommand || 'sudo apt update && sudo apt install -y certbot';
                        navigator.clipboard.writeText(cmd);
                        setCopiedInstallCmd(true);
                        setTimeout(() => setCopiedInstallCmd(false), 2000);
                      }}
                      className="text-gray-400 hover:text-white flex items-center space-x-1 cursor-pointer transition-colors"
                    >
                      <Copy className="w-3 h-3" />
                      <span>Copy command</span>
                    </button>
                  )}
                </div>
                <div className="bg-[#0c0c14] p-2.5 rounded-xl border border-white/10 font-mono text-[11px] text-emerald-300 break-all select-all flex items-center justify-between">
                  <code>{certbotStatus?.suggestedCommand || 'sudo apt update && sudo apt install -y certbot'}</code>
                </div>
              </div>

              {(isInstallingCertbot || installOutput) && (
                <div className="space-y-1.5 pt-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-white flex items-center space-x-2">
                      <Terminal className="w-3.5 h-3.5 text-blue-400" />
                      <span>Installation Console Output</span>
                    </span>
                    {isInstallingCertbot && (
                      <span className="text-xs text-amber-400 flex items-center space-x-1.5">
                        <RefreshCw className="w-3 h-3 animate-spin" />
                        <span>Running package installation on host...</span>
                      </span>
                    )}
                  </div>
                  <div className="max-h-48 overflow-y-auto bg-[#0a0a10] p-3 rounded-xl border border-white/10 font-mono text-[10px] text-gray-300 select-text leading-relaxed whitespace-pre-wrap">
                    {installOutput}
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-white/10">
              <button
                onClick={() => setShowInstallAlertModal(false)}
                disabled={isInstallingCertbot}
                className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-gray-300 hover:text-white text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50"
              >
                {certbotStatus?.installed ? 'Done' : 'Close'}
              </button>

              <button
                onClick={handleInstallCertbot}
                disabled={isInstallingCertbot || (!hasSudo && !isRoot)}
                className="flex items-center space-x-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white text-xs font-semibold shadow-lg shadow-emerald-900/40 transition-all cursor-pointer disabled:opacity-50"
              >
                {isInstallingCertbot ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Installing Certbot...</span>
                  </>
                ) : (
                  <>
                    <Download className="w-3.5 h-3.5" />
                    <span>Install Certbot Only</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

export { SslManager };
