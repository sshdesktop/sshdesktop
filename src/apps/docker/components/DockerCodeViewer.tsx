import React, { useState, useMemo } from 'react';
import { Copy, Check, Terminal, Play } from 'lucide-react';

interface DockerCommandSnippetProps {
  command: string;
  onRunInTerminal?: () => void;
  className?: string;
  label?: string;
}

/**
 * Tokenizes a Docker CLI command string into colorful syntax tokens
 */
export const DockerCommandSnippet: React.FC<DockerCommandSnippetProps> = ({
  command,
  onRunInTerminal,
  className = '',
  label = 'CLI'
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const tokens = useMemo(() => {
    if (!command) return null;
    const regex = /("[^"]*"|'[^']*'|\$[{]?[A-Za-z0-9_]+[}]?|--?[a-zA-Z0-9_-]+|\|{1,2}|&&|>>|>|;|sudo|docker-compose|docker\s+compose|docker|\b[a-zA-Z0-9_\-\./:]+\b|\s+)/g;
    const parts = command.match(regex) || [command];
    let isCommandStart = true;

    return parts.map((part, i) => {
      if (/^\s+$/.test(part)) return <span key={i}>{part}</span>;

      // Sudo in rose
      if (part === 'sudo') {
        isCommandStart = true;
        return <span key={i} className="text-rose-400 font-bold">{part}</span>;
      }

      // Docker root commands in neon emerald
      if (part === 'docker' || part === 'docker-compose' || part === 'docker compose') {
        isCommandStart = false;
        return <span key={i} className="text-emerald-400 font-bold drop-shadow-[0_0_8px_rgba(52,211,153,0.3)]">{part}</span>;
      }

      // Operators: |, &&, ;, >, >> in purple
      if (/^(\|{1,2}|&&|>>|>|;)$/.test(part)) {
        isCommandStart = true;
        return <span key={i} className="text-purple-400 font-bold mx-0.5">{part}</span>;
      }

      // Strings in soft amber
      if (/^("[^"]*"|'[^']*')$/.test(part)) {
        return <span key={i} className="text-amber-200">{part}</span>;
      }

      // Variables in bright cyan
      if (/^\$[{]?[A-Za-z0-9_]+[}]?$/.test(part)) {
        return <span key={i} className="text-cyan-300 font-bold">{part}</span>;
      }

      // Flags and options in amber
      if (/^--?[a-zA-Z0-9_-]+$/.test(part)) {
        return <span key={i} className="text-amber-400 font-semibold">{part}</span>;
      }

      // Docker Subcommands in vivid sky blue
      const SUB_COMMANDS = new Set([
        'run', 'build', 'pull', 'push', 'exec', 'stop', 'start', 'restart', 'rm', 'rmi',
        'ps', 'logs', 'inspect', 'commit', 'tag', 'network', 'volume', 'system', 'prune',
        'create', 'ls', 'compose', 'up', 'down', 'login', 'logout', 'images', 'info',
        'top', 'stats', 'port', 'wait', 'kill', 'pause', 'unpause', 'diff', 'cp'
      ]);

      if (SUB_COMMANDS.has(part.toLowerCase())) {
        return <span key={i} className="text-sky-300 font-semibold">{part}</span>;
      }

      // Port bindings (e.g. 8080:80, 5432:5432) or IP endpoints in cyan
      if (/^\d+:\d+$/.test(part) || /^\d+\.\d+\.\d+\.\d+:\d+:\d+$/.test(part)) {
        return <span key={i} className="text-cyan-300 font-mono font-medium">{part}</span>;
      }

      // Mounts & paths (contains / or .) in indigo/purple
      if (part.includes('/') || (part.includes('.') && !part.includes(':'))) {
        return <span key={i} className="text-indigo-300">{part}</span>;
      }

      // Target image or container identifier (e.g., nginx:alpine, redis:7-alpine)
      if (part.includes(':')) {
        const [img, tag] = part.split(':');
        return (
          <span key={i}>
            <span className="text-purple-300 font-semibold">{img}</span>
            <span className="text-gray-400">:</span>
            <span className="text-emerald-300 font-bold">{tag}</span>
          </span>
        );
      }

      return <span key={i} className="text-gray-200">{part}</span>;
    });
  }, [command]);

  return (
    <div className={`p-2.5 rounded-xl bg-[#0c0d14] border border-white/10 shadow-inner flex items-center justify-between gap-3 text-xs font-mono select-all ${className}`}>
      <div className="flex items-center space-x-2 min-w-0 overflow-x-auto">
        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 shrink-0">
          {label}
        </span>
        <code className="text-[11px] leading-relaxed whitespace-pre truncate">
          {tokens}
        </code>
      </div>
      <div className="flex items-center space-x-1 shrink-0 select-none">
        <button
          type="button"
          onClick={handleCopy}
          className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white transition-colors cursor-pointer flex items-center space-x-1"
          title="Copy command to clipboard"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          <span className="text-[10px]">{copied ? 'Copied' : 'Copy'}</span>
        </button>
        {onRunInTerminal && (
          <button
            type="button"
            onClick={onRunInTerminal}
            className="p-1.5 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/30 transition-colors cursor-pointer flex items-center space-x-1"
            title="Execute in interactive terminal"
          >
            <Terminal className="w-3.5 h-3.5 text-blue-400" />
            <span className="text-[10px]">Run</span>
          </button>
        )}
      </div>
    </div>
  );
};

/**
 * Tokenizes individual Docker container log lines with rich colors for timestamps,
 * log levels, HTTP methods, status codes, URLs, and JSON keys
 */
export const DockerLogLine: React.FC<{
  line: string;
  index: number;
  showLineNumber?: boolean;
}> = ({ line, index, showLineNumber = true }) => {
  const content = useMemo(() => {
    if (!line) return <span className="text-gray-600">— empty line —</span>;

    // Detect timestamps (e.g. 2026-10-26T12:00:00.000Z or 2026-10-26 12:00:00)
    const timestampRegex = /^(\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)\s*(.*)$/;
    const tsMatch = line.match(timestampRegex);
    const timestamp = tsMatch ? tsMatch[1] : null;
    const remaining = tsMatch ? tsMatch[2] : line;

    // Detect level tag
    let levelBadge: React.ReactNode = null;
    let restOfLine = remaining;

    const levelRegex = /\b(ERROR|FATAL|EXCEPTION|PANIC|CRITICAL|WARN|WARNING|INFO|INFORMATION|DEBUG|TRACE|SUCCESS|READY|DONE)\b/i;
    const lvlMatch = remaining.match(levelRegex);

    if (lvlMatch) {
      const lvl = lvlMatch[1].toUpperCase();
      let colorClass = 'bg-blue-500/20 text-blue-300 border-blue-500/30';
      if (['ERROR', 'FATAL', 'EXCEPTION', 'PANIC', 'CRITICAL'].includes(lvl)) {
        colorClass = 'bg-rose-500/20 text-rose-300 border-rose-500/30';
      } else if (['WARN', 'WARNING'].includes(lvl)) {
        colorClass = 'bg-amber-500/20 text-amber-300 border-amber-500/30';
      } else if (['DEBUG', 'TRACE'].includes(lvl)) {
        colorClass = 'bg-purple-500/20 text-purple-300 border-purple-500/30';
      } else if (['SUCCESS', 'READY', 'DONE'].includes(lvl)) {
        colorClass = 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30';
      }

      levelBadge = (
        <span className={`px-1.5 py-0.2 rounded text-[9px] font-bold uppercase tracking-wider border mr-1.5 shrink-0 ${colorClass}`}>
          {lvl}
        </span>
      );
    }

    // Highlighting HTTP methods, status codes, IPs, URLs, JSON keys
    const tokenRegex = /(\b(?:GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\b|\b(?:200|201|204|301|302|304|400|401|403|404|422|500|502|503|504)\b|https?:\/\/[^\s"]+|\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b|"[a-zA-Z0-9_\-]+":|"[^"]*"|'[^']*'|\s+)/g;
    const tokens = restOfLine.match(tokenRegex) || [restOfLine];

    const parsedTokens = tokens.map((t, idx) => {
      // HTTP Methods
      if (/^(GET)$/.test(t)) return <span key={idx} className="px-1 py-0.2 rounded bg-emerald-500/20 text-emerald-300 font-bold text-[10px]">{t}</span>;
      if (/^(POST)$/.test(t)) return <span key={idx} className="px-1 py-0.2 rounded bg-sky-500/20 text-sky-300 font-bold text-[10px]">{t}</span>;
      if (/^(PUT|PATCH)$/.test(t)) return <span key={idx} className="px-1 py-0.2 rounded bg-amber-500/20 text-amber-300 font-bold text-[10px]">{t}</span>;
      if (/^(DELETE)$/.test(t)) return <span key={idx} className="px-1 py-0.2 rounded bg-rose-500/20 text-rose-300 font-bold text-[10px]">{t}</span>;
      if (/^(HEAD|OPTIONS)$/.test(t)) return <span key={idx} className="px-1 py-0.2 rounded bg-purple-500/20 text-purple-300 font-bold text-[10px]">{t}</span>;

      // Status Codes
      if (/^2\d\d$/.test(t)) return <span key={idx} className="text-emerald-400 font-bold">{t}</span>;
      if (/^3\d\d$/.test(t)) return <span key={idx} className="text-cyan-400 font-bold">{t}</span>;
      if (/^4\d\d$/.test(t)) return <span key={idx} className="text-amber-400 font-bold">{t}</span>;
      if (/^5\d\d$/.test(t)) return <span key={idx} className="text-rose-400 font-bold">{t}</span>;

      // URL or IP
      if (/^https?:\/\//.test(t)) return <span key={idx} className="text-cyan-300 underline underline-offset-2">{t}</span>;
      if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(t)) return <span key={idx} className="text-indigo-300 font-mono">{t}</span>;

      // JSON key
      if (/^"[a-zA-Z0-9_\-]+":$/.test(t)) return <span key={idx} className="text-cyan-300 font-medium">{t}</span>;

      // Strings
      if (/^("[^"]*"|'[^']*')$/.test(t)) return <span key={idx} className="text-amber-200">{t}</span>;

      return <span key={idx}>{t}</span>;
    });

    return (
      <div className="flex items-start">
        {timestamp && (
          <span className="text-gray-500 text-[10px] mr-2 shrink-0 select-none font-mono">
            {timestamp}
          </span>
        )}
        {levelBadge}
        <span className="leading-relaxed text-gray-200 break-words flex-1">
          {parsedTokens}
        </span>
      </div>
    );
  }, [line]);

  return (
    <div className="flex items-start hover:bg-white/[0.04] px-1 py-0.5 rounded transition-colors group">
      {showLineNumber && (
        <span className="text-[10px] text-gray-600 w-10 text-right pr-3 select-none shrink-0 font-mono pt-0.5 group-hover:text-gray-400">
          {index + 1}
        </span>
      )}
      <div className="flex-1 min-w-0 font-mono text-[11px]">
        {content}
      </div>
    </div>
  );
};

/**
 * Tokenizes Docker build and docker-compose execution outputs with colorful highlights
 */
export const DockerBuildOutputLine: React.FC<{
  line: string;
  index: number;
}> = ({ line, index }) => {
  const content = useMemo(() => {
    const trimmed = line.trim();

    // Step indicator: Step 1/12 : FROM ... or => [internal] load ...
    if (/^Step \d+\/\d+\s*:/.test(trimmed) || /^=>\s+\[.*\]/.test(trimmed)) {
      return (
        <span className="text-sky-300 font-bold bg-sky-500/10 px-1.5 py-0.5 rounded border border-sky-500/20 inline-block my-0.5">
          {trimmed}
        </span>
      );
    }

    // Cached layers: ---> Using cache or CACHED
    if (trimmed.includes('Using cache') || trimmed.includes('CACHED')) {
      return (
        <span className="text-emerald-400 font-semibold flex items-center space-x-1">
          <span className="text-emerald-300">✓</span>
          <span>{trimmed}</span>
        </span>
      );
    }

    // Success builds & tags: Successfully built ... or Successfully tagged ...
    if (trimmed.startsWith('Successfully built') || trimmed.startsWith('Successfully tagged')) {
      return (
        <span className="text-emerald-300 font-bold bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 rounded shadow-[0_0_12px_rgba(52,211,153,0.3)] inline-block my-0.5">
          ✨ {trimmed}
        </span>
      );
    }

    // Docker Compose actions: Creating ..., Starting ..., Started, Healthy
    if (/^(Creating|Starting|Recreating|Stopping|Removing|Attaching to)\s+/.test(trimmed)) {
      return <span className="text-teal-300 font-semibold">{trimmed}</span>;
    }
    if (trimmed.includes('Started') || trimmed.includes('Healthy') || trimmed.includes('Running')) {
      return <span className="text-emerald-400 font-bold">✓ {trimmed}</span>;
    }

    // Layer IDs: ---> 3a1b2c3d4e5f
    if (/^--->\s+[0-9a-fA-F]+$/.test(trimmed)) {
      return (
        <span className="text-purple-400 font-mono text-[10px]">
          {trimmed}
        </span>
      );
    }

    // Errors: ERROR, failed to solve, Error:
    if (/^(ERROR|failed to solve|Error:|FATAL)/i.test(trimmed)) {
      return (
        <span className="text-rose-400 font-semibold bg-rose-500/15 border border-rose-500/30 px-1.5 py-0.5 rounded inline-block">
          ❌ {trimmed}
        </span>
      );
    }

    // Warnings: WARNING, WARN
    if (/^(WARNING|WARN)/i.test(trimmed)) {
      return (
        <span className="text-amber-300 font-medium bg-amber-500/10 border border-amber-500/20 px-1 py-0.2 rounded inline-block">
          ⚠️ {trimmed}
        </span>
      );
    }

    // RUN / COPY / WORKDIR commands inside Dockerfile build
    if (/^(RUN|COPY|WORKDIR|ENV|EXPOSE|CMD|ENTRYPOINT|VOLUME|USER|ARG)\s+/.test(trimmed)) {
      const parts = trimmed.split(/\s+/);
      const instruction = parts[0];
      const args = parts.slice(1).join(' ');
      return (
        <span>
          <span className="text-amber-400 font-bold">{instruction} </span>
          <span className="text-cyan-200">{args}</span>
        </span>
      );
    }

    return <span className="text-gray-300">{line}</span>;
  }, [line]);

  return (
    <div className="hover:bg-white/[0.03] px-1 py-0.5 rounded transition-colors font-mono text-xs leading-relaxed select-text flex items-start">
      <span className="text-[10px] text-gray-600 w-8 text-right pr-2 select-none shrink-0 font-mono pt-0.5">
        {index + 1}
      </span>
      <div className="flex-1 min-w-0">
        {content}
      </div>
    </div>
  );
};
