import { sshExec } from '../../../lib/tauri-bridge';

export interface SshHttpResponse {
  statusCode: number;
  statusText: string;
  contentType: string;
  headers: Record<string, string>;
  body: string;
  latencyMs: number;
  bytesReceived: number;
  executedCommand: string;
  isHtml: boolean;
  isJson: boolean;
}

/**
 * Normalizes input text into a complete HTTP/HTTPS URL
 */
export function normalizeTargetUrl(input: string): string {
  let target = input.trim();
  if (!target) return '';

  if (target.startsWith('http://') || target.startsWith('https://')) {
    return target;
  }

  // Pure port like "8080" or ":8080"
  if (/^:?\d+$/.test(target)) {
    const port = target.replace(':', '');
    return `http://127.0.0.1:${port}`;
  }

  // IP addresses or localhost
  const isIpOrLocal = /^(\d{1,3}\.){3}\d{1,3}(:\d+)?(\/.*)?$/.test(target) || 
                      /^localhost(:\d+)?(\/.*)?$/i.test(target) || 
                      /^127\.0\.0\.1(:\d+)?(\/.*)?$/.test(target) ||
                      /^0\.0\.0\.0(:\d+)?(\/.*)?$/.test(target);

  if (isIpOrLocal) {
    return `http://${target}`;
  }

  // Multi-word searches without dot/colon
  if (/\s/.test(target) || (!target.includes('.') && !target.includes(':'))) {
    return `https://www.google.com/search?q=${encodeURIComponent(target)}`;
  }

  // Default standard web domains to HTTPS
  return `https://${target}`;
}

/**
 * Execute HTTP request on the remote Linux server via SSH cURL gateway.
 * The request is executed directly from the SSH server's network stack,
 * reaching both public URLs and private/internal IPs from the server's perspective.
 */
export async function fetchViaSshGateway(
  connId: string,
  url: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'HEAD' = 'GET',
  headers: Record<string, string> = {},
  body?: string
): Promise<SshHttpResponse> {
  const startTime = Date.now();
  const targetUrl = normalizeTargetUrl(url);

  // Safe header flags for curl
  const defaultHeaders: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 SSHDesktop/2.0',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json,text/plain,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    ...headers
  };

  const headerFlags = Object.entries(defaultHeaders)
    .map(([k, v]) => `-H '${k}: ${v.replace(/'/g, "'\\''")}'`)
    .join(' ');

  // Safe single-quote URL escaping for bash
  const safeUrl = targetUrl.replace(/'/g, "'\\''");

  let bodyFlag = '';
  if (body && (method === 'POST' || method === 'PUT')) {
    bodyFlag = `--data '${body.replace(/'/g, "'\\''")}'`;
  }

  // Comprehensive curl command on server:
  // -s: silent mode (suppress progress meter)
  // -i: include protocol response headers in stdout
  // -k: allow insecure/self-signed SSL certificates (essential for router/device IPs & local servers)
  // -L: follow HTTP redirects
  // --compressed: automatically decompress gzip, deflate, and brotli responses to clean text
  // --max-time 20: 20-second timeout to prevent hanging on unreachable IPs
  const curlCmd = `curl -s -i -k -L --compressed --max-time 20 -X ${method} ${headerFlags} ${bodyFlag} '${safeUrl}' 2>/dev/null`;

  const result = await sshExec(connId, curlCmd);
  const latencyMs = Date.now() - startTime;
  const rawOutput = result.stdout || '';

  if (result.exit_code !== 0 && !rawOutput) {
    const errText = result.stderr ? result.stderr.trim() : '';
    throw new Error(errText || `Could not reach ${targetUrl} via SSH server. Remote host or port may be unreachable, filtered by firewall, or timed out.`);
  }

  return parseRawCurlResponse(rawOutput, targetUrl, latencyMs, curlCmd);
}

/**
 * Parse raw cURL -i response (headers + body)
 */
export function parseRawCurlResponse(
  raw: string,
  targetUrl: string,
  latencyMs: number,
  executedCommand: string
): SshHttpResponse {
  // cURL with -L can have multiple HTTP header blocks (e.g., HTTP/1.1 301 ... HTTP/1.1 200 OK)
  const headerBlocks = raw.split(/\r?\n\r?\n/);
  
  // Find the last HTTP/x.x status header block
  let finalHeaderIndex = 0;
  for (let i = 0; i < headerBlocks.length - 1; i++) {
    const block = headerBlocks[i].trim();
    if (/^HTTP\/[\d.]+/i.test(block)) {
      finalHeaderIndex = i;
    }
  }

  const rawHeaders = headerBlocks[finalHeaderIndex] || '';
  const body = headerBlocks.slice(finalHeaderIndex + 1).join('\n\n');

  // Parse status line (e.g. "HTTP/1.1 200 OK" or "HTTP/2 200")
  const headerLines = rawHeaders.split(/\r?\n/);
  const statusLine = headerLines[0] || 'HTTP/1.1 200 OK';
  const statusMatch = statusLine.match(/HTTP\/[\d.]+\s+(\d+)\s*(.*)/i);
  const statusCode = statusMatch ? parseInt(statusMatch[1], 10) : 200;
  const statusText = statusMatch ? statusMatch[2].trim() || 'OK' : 'OK';

  // Parse headers into key-value map
  const headersMap: Record<string, string> = {};
  for (let i = 1; i < headerLines.length; i++) {
    const line = headerLines[i].trim();
    if (!line) continue;
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim().toLowerCase();
      const val = line.slice(colonIdx + 1).trim();
      headersMap[key] = val;
    }
  }

  const contentType = (headersMap['content-type'] || 'text/html').toLowerCase();
  const trimmedBody = body.trim();
  const isHtml = contentType.includes('html') || 
                 trimmedBody.startsWith('<!DOCTYPE') || 
                 trimmedBody.startsWith('<html') ||
                 trimmedBody.includes('<body');
  const isJson = contentType.includes('json') || 
                 (trimmedBody.startsWith('{') && trimmedBody.endsWith('}')) || 
                 (trimmedBody.startsWith('[') && trimmedBody.endsWith(']'));

  return {
    statusCode,
    statusText,
    contentType,
    headers: headersMap,
    body,
    latencyMs,
    bytesReceived: raw.length,
    executedCommand,
    isHtml,
    isJson,
  };
}

/**
 * Prepare and sanitize HTML to be rendered in sandboxed iframe:
 * - Adds <base href="..."> so relative paths (CSS, images, JS, links) resolve to target origin
 * - Strips meta CSP / X-Frame-Options tags that would block iframe execution
 * - Injects navigation interception script to route link clicks and form submits via SSH server
 */
export function prepareHtmlForSandbox(html: string, currentUrl: string): string {
  try {
    const urlObj = new URL(currentUrl);
    const origin = urlObj.origin;
    const pathname = urlObj.pathname;
    const basePath = pathname.endsWith('/') ? pathname : pathname.substring(0, pathname.lastIndexOf('/') + 1) || '/';
    const baseUrl = `${origin}${basePath}`;

    // Script to intercept navigation inside iframe and communicate with parent
    const interceptScript = `
      <script>
        (function() {
          // Intercept all link clicks
          document.addEventListener('click', function(e) {
            var target = e.target;
            while (target && target.tagName !== 'A') {
              target = target.parentElement;
            }
            if (target && target.href) {
              var href = target.getAttribute('href') || '';
              // Ignore javascript: and on-page fragment anchors (#section)
              if (href.startsWith('#') || href.startsWith('javascript:')) {
                return;
              }
              e.preventDefault();
              e.stopPropagation();
              window.parent.postMessage({
                type: 'sshdesktop-browser-navigate',
                url: target.href
              }, '*');
            }
          }, true);

          // Intercept all form submissions
          document.addEventListener('submit', function(e) {
            var form = e.target;
            if (form && form.action) {
              e.preventDefault();
              e.stopPropagation();
              var actionUrl = form.action;
              var method = (form.method || 'GET').toUpperCase();
              var formData = new FormData(form);
              var params = new URLSearchParams(formData).toString();
              if (method === 'GET') {
                var separator = actionUrl.indexOf('?') >= 0 ? '&' : '?';
                window.parent.postMessage({
                  type: 'sshdesktop-browser-navigate',
                  url: actionUrl + separator + params
                }, '*');
              } else {
                window.parent.postMessage({
                  type: 'sshdesktop-browser-submit',
                  url: actionUrl,
                  method: method,
                  body: params
                }, '*');
              }
            }
          }, true);
        })();
      </script>
    `;

    // Strip meta tags that could prevent iframe from executing scripts or embedding
    let modifiedHtml = html.replace(/<meta[^>]*http-equiv=["']?(content-security-policy|x-frame-options)["']?[^>]*>/gi, '');

    const baseTag = `<base href="${baseUrl}">\n`;

    if (modifiedHtml.includes('<head>')) {
      modifiedHtml = modifiedHtml.replace('<head>', `<head>\n${baseTag}${interceptScript}`);
    } else if (modifiedHtml.includes('<html>')) {
      modifiedHtml = modifiedHtml.replace('<html>', `<html>\n<head>\n${baseTag}${interceptScript}</head>`);
    } else {
      modifiedHtml = `${baseTag}${interceptScript}\n${modifiedHtml}`;
    }

    return modifiedHtml;
  } catch {
    return html;
  }
}
