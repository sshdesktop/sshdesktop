import React, { lazy, Suspense } from 'react';
import { useWindowManager } from '../lib/hooks/useWindowManager';
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

const APP_COMPONENTS: Record<string, React.LazyExoticComponent<React.FC>> = {
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

import { useConnectionStore } from '../lib/store';

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
              <Suspense fallback={<AppLoader />}>
                <AppComp />
              </Suspense>
            </Window>
          </div>
        );
      })}
    </>
  );
}
