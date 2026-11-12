import React, { lazy, Suspense } from 'react';
import { useWindowManager } from '../lib/hooks/useWindowManager';
import { useConnectionStore } from '../lib/store';
import Window from './Window';

// Lazy-load all app components for performance
const TerminalApp = lazy(() => import('../apps/terminal/Terminal'));
const FileManager = lazy(() => import('../apps/filemanager/FileManager'));
const CodeEditor = lazy(() => import('../apps/editor/CodeEditor'));
const SystemMonitor = lazy(() => import('../apps/monitor/SystemMonitor'));
const ProcessManager = lazy(() => import('../apps/processes/ProcessManager'));
const ServiceManager = lazy(() => import('../apps/services/ServiceManager'));
const DockerManager = lazy(() => import('../apps/docker/DockerManager'));
const LogViewer = lazy(() => import('../apps/logs/LogViewer'));
const NetworkManager = lazy(() => import('../apps/network/NetworkManager'));
const PackageManager = lazy(() => import('../apps/packages/PackageManager'));
const UserManager = lazy(() => import('../apps/users/UserManager'));
const CronManager = lazy(() => import('../apps/cron/CronManager'));
const DatabaseClient = lazy(() => import('../apps/database/DatabaseClient'));
const FirewallManager = lazy(() => import('../apps/firewall/FirewallManager'));
const DiskManager = lazy(() => import('../apps/disk/DiskManager'));
const SecurityAuditor = lazy(() => import('../apps/security/SecurityAuditor'));
const Notes = lazy(() => import('../apps/notes/Notes'));
const AppSettings = lazy(() => import('../apps/settings/AppSettings'));
const EnvManager = lazy(() => import('../apps/env/EnvManager'));
const SshApp = lazy(() => import('../apps/ssh/SshApp'));
const BrowserApp = lazy(() => import('../apps/browser/BrowserApp'));
const ApiApp = lazy(() => import('../apps/api/ApiApp'));
const SslManager = lazy(() => import('../apps/ssl/SslManager'));
const AutomationApp = lazy(() => import('../apps/automation/AutomationApp'));

const APP_COMPONENTS: Record<string, React.LazyExoticComponent<React.FC>> = {
  automation: AutomationApp,
  ssl: SslManager,
  api: ApiApp,
  ssh: SshApp,
  browser: BrowserApp,
  terminal: TerminalApp,
  files: FileManager,
  editor: CodeEditor,
  monitor: SystemMonitor,
  processes: ProcessManager,
  services: ServiceManager,
  docker: DockerManager,
  logs: LogViewer,
  network: NetworkManager,
  packages: PackageManager,
  users: UserManager,
  cron: CronManager,
  database: DatabaseClient,
  firewall: FirewallManager,
  disks: DiskManager,
  security: SecurityAuditor,
  notes: Notes,
  settings: AppSettings,
  env: EnvManager,
};

interface ErrorBoundaryProps {
  appId: string;
  onReset?: () => void;
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class AppErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error(`[AppErrorBoundary] App "${this.props.appId}" caught crash:`, error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="w-full h-full flex flex-col items-center justify-center p-6 bg-[var(--bg)] text-[var(--text)] select-text">
          <div className="max-w-md w-full bg-red-500/10 border border-red-500/30 rounded-2xl p-5 shadow-xl flex flex-col items-center text-center space-y-3">
            <div className="w-12 h-12 rounded-full bg-red-500/20 text-red-400 flex items-center justify-center font-bold text-xl">
              !
            </div>
            <h3 className="font-semibold text-base text-red-400">
              Application Notice ({this.props.appId})
            </h3>
            <p className="text-xs text-[var(--text-secondary)] font-mono break-all line-clamp-3">
              {this.state.error?.message || 'An unexpected rendering error occurred in this window.'}
            </p>
            <div className="flex space-x-3 pt-2">
              <button
                type="button"
                onClick={this.handleReset}
                className="px-4 py-1.5 rounded-lg bg-[var(--accent)] text-white text-xs font-medium hover:brightness-110 active:scale-95 transition-all cursor-pointer shadow-md"
              >
                Reload App
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function AppLoader() {
  return (
    <div className="w-full h-full flex items-center justify-center bg-[var(--bg)]">
      <div className="flex flex-col items-center space-y-3">
        <div className="w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
        <span className="text-sm text-[var(--text-secondary)]">Loading...</span>
      </div>
    </div>
  );
}

export default function WindowManager() {
  const { allWindows } = useWindowManager();
  const activeConnId = useConnectionStore((s) => s.activeConnectionId);

  return (
    <>
      {allWindows.map(win => {
        const isCurrentServer = !win.serverId || win.serverId === activeConnId;
        const AppComp = APP_COMPONENTS[win.appId];
        if (!AppComp) {
          return isCurrentServer ? (
            <Window key={win.id} window={win}>
              <div className="w-full h-full flex items-center justify-center text-[var(--text-secondary)]">
                App "{win.appId}" not found
              </div>
            </Window>
          ) : null;
        }
        return (
          <div 
            key={win.id} 
            style={{ display: isCurrentServer ? 'contents' : 'none' }}
          >
            <Window window={win}>
              <AppErrorBoundary appId={win.appId}>
                <Suspense fallback={<AppLoader />}>
                  <AppComp />
                </Suspense>
              </AppErrorBoundary>
            </Window>
          </div>
        );
      })}
    </>
  );
}
