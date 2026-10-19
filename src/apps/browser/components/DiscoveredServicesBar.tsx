import React, { useState, useEffect } from 'react';
import { 
  Server, Globe, RefreshCw, Zap, Shield, Cpu, Container, 
  ChevronRight, ExternalLink, Activity
} from 'lucide-react';
import { DiscoveredWebService } from '../types';
import { sshExec } from '../../../lib/tauri-bridge';

const COMMON_PORT_NAMES: Record<number, string> = {
  80: 'HTTP Web Server (Nginx/Apache)',
  443: 'HTTPS Web Server',
  3000: 'Node.js / React / Dev Server',
  3001: 'Grafana / Uptime Kuma',
  5000: 'Flask / Python / Docker Registry',
  5173: 'Vite Dev Server',
  8000: 'FastAPI / Django / PHP',
  8080: 'Web Application / Tomcat / API',
  8081: 'Adminer / Microservice',
  8443: 'HTTPS Web Admin',
  8888: 'Jupyter Notebook / Web GUI',
  9000: 'Portainer Docker UI / PHP-FPM',
  9090: 'Prometheus Metrics Server',
  19999: 'Netdata Realtime Linux Dashboard',
};

interface DiscoveredServicesBarProps {
  connId: string;
  onSelectService: (url: string) => void;
  isLight?: boolean;
}

export default function DiscoveredServicesBar({
  connId,
  onSelectService,
  isLight = false,
}: DiscoveredServicesBarProps) {
  const [services, setServices] = useState<DiscoveredWebService[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);

  const scanServices = async () => {
    if (!connId) return;
    setIsLoading(true);

    try {
      // ss command to list all listening TCP ports and process names
      const res = await sshExec(
        connId,
        'ss -tulnp 2>/dev/null || netstat -tulnp 2>/dev/null || lsof -iTCP -sTCP:LISTEN -n -P 2>/dev/null || true'
      );

      const stdout = res.stdout || '';
      const lines = stdout.split('\n');
      const foundPorts = new Map<number, DiscoveredWebService>();

      lines.forEach(line => {
        // Match listening ports: e.g. 127.0.0.1:8080 or 0.0.0.0:3000 or [::]:9000
        const portMatch = line.match(/(?:127\.0\.0\.1|0\.0\.0\.0|\*|::|\[::\]):(\d+)/);
        if (portMatch) {
          const port = parseInt(portMatch[1], 10);
          // Filter out typical non-web system ports (22 ssh, 25 smtp, 53 dns)
          if (port === 22 || port === 25 || port === 53 || port > 65535) return;

          // Try to extract process name: e.g. users:(("node",pid=1234,fd=20))
          let processName = '';
          const procMatch = line.match(/users:\(\("([^"]+)"/i) || line.match(/([a-zA-Z0-9_\-]+)\s+pid=/i);
          if (procMatch) {
            processName = procMatch[1];
          }

          const serviceName = COMMON_PORT_NAMES[port] || (processName ? `${processName} Service` : `Service on ${port}`);
          const isPrivate = line.includes('127.0.0.1') || line.includes('::1');

          if (!foundPorts.has(port)) {
            foundPorts.set(port, {
              port,
              protocol: port === 443 || port === 8443 ? 'https' : 'http',
              name: serviceName,
              url: `http://localhost:${port}`,
              processName: processName || undefined,
              isPrivate,
            });
          }
        }
      });

      const list = Array.from(foundPorts.values()).sort((a, b) => a.port - b.port);
      setServices(list);
    } catch {
      // Fallback: provide common defaults if scanning is restricted
      setServices([
        { port: 8080, protocol: 'http', name: 'Web Application (8080)', url: 'http://localhost:8080', isPrivate: true },
        { port: 3000, protocol: 'http', name: 'Node / React Server (3000)', url: 'http://localhost:3000', isPrivate: true },
        { port: 80, protocol: 'http', name: 'HTTP Web Server (80)', url: 'http://localhost', isPrivate: false },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    scanServices();
  }, [connId]);

  if (services.length === 0 && !isLoading) return null;

  return (
    <div className="px-3 py-1.5 bg-[#181825] border-b border-white/[0.06] flex items-center justify-between text-xs text-gray-300 select-none font-sans shrink-0">
      <div className="flex items-center space-x-2 overflow-x-auto no-scrollbar py-0.5">
        <div className="flex items-center space-x-1 text-cyan-400 font-semibold text-[11px] shrink-0 mr-1">
          <Server className="w-3.5 h-3.5" />
          <span>Server Apps:</span>
        </div>

        {services.map(s => (
          <button
            key={s.port}
            onClick={() => onSelectService(s.url)}
            className="flex items-center space-x-1.5 px-2.5 py-1 rounded-xl bg-white/5 hover:bg-blue-600/20 hover:border-blue-500/40 text-gray-200 hover:text-white border border-white/10 text-[11px] transition-all cursor-pointer shrink-0 group"
            title={`Access private ${s.name} on remote server`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${s.isPrivate ? 'bg-emerald-400 animate-pulse' : 'bg-cyan-400'}`} />
            <span className="font-mono font-semibold text-white">:{s.port}</span>
            <span className="text-gray-400 group-hover:text-gray-200 truncate max-w-[120px]">{s.name.split(' ')[0]}</span>
            <ExternalLink className="w-2.5 h-2.5 opacity-0 group-hover:opacity-100 text-blue-400" />
          </button>
        ))}
      </div>

      <div className="flex items-center space-x-1 shrink-0 ml-2">
        <button
          onClick={scanServices}
          className="p-1 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors cursor-pointer"
          title="Rescan server listening ports"
        >
          <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>
    </div>
  );
}
