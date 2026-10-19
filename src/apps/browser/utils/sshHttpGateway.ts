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
}

/**
 * Execute HTTP request on the remote Linux server via SSH cURL gateway
 */
export async function fetchViaSshGateway(
  connId: string,
  url: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'HEAD' = 'GET',
  headers: Record<string, string> = {},
  body?: string
): Promise<SshHttpResponse> {
  const startTime = Date.now();

  // Normalize URL
  let targetUrl = url.trim();
  if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
    targetUrl = `http://${targetUrl}`;
  }

  // Header flags for curl
  const headerFlags = Object.entries({
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 CloudDesk/2.0',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    ...headers
  }).map(([k, v]) => `-H "${k}: ${v.replace(/"/g, '\\"')}"`).join(' ');

  // Safe curl command on server:
  // -s: silent
  // -i: include protocol response headers
  // -k: allow insecure/self-signed SSL on internal localhost/LAN
  // -L: follow HTTP redirects
  // --max-time 15: timeout after 15s to prevent hanging
  const sanitizedUrl = targetUrl.replace(/"/g, '\\"');
  let bodyFlag = '';
  if (body && (method === 'POST' || method === 'PUT')) {
    bodyFlag = `--data '${body.replace(/'/g, "'\\''")}'`;
  }

  const curlCmd = `curl -s -i -k -L --max-time 15 -X ${method} ${headerFlags} ${bodyFlag} "${sanitizedUrl}" 2>/dev/null`;

  const result = await sshExec(connId, curlCmd);
  const latencyMs = Date.now() - startTime;
  const rawOutput = result.stdout || '';

  if (result.exit_code !== 0 && !rawOutput) {
    throw new Error(result.stderr || `Failed to connect to ${targetUrl} via server. Service might be down on server.`);
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
    if (headerBlocks[i].startsWith('HTTP/') || headerBlocks[i].includes('HTTP/1.') || headerBlocks[i].includes('HTTP/2')) {
      finalHeaderIndex = i;
    }
  }

  const rawHeaders = headerBlocks[finalHeaderIndex] || '';
  const body = headerBlocks.slice(finalHeaderIndex + 1).join('\n\n');

  // Parse status line
  const headerLines = rawHeaders.split(/\r?\n/);
  const statusLine = headerLines[0] || 'HTTP/1.1 200 OK';
  const statusMatch = statusLine.match(/HTTP\/[\d.]+\s+(\d+)\s*(.*)/i);
  const statusCode = statusMatch ? parseInt(statusMatch[1], 10) : 200;
  const statusText = statusMatch ? statusMatch[2].trim() || 'OK' : 'OK';

  // Parse headers into map
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

  const contentType = headersMap['content-type'] || 'text/html';

  return {
    statusCode,
    statusText,
    contentType,
    headers: headersMap,
    body,
    latencyMs,
    bytesReceived: raw.length,
    executedCommand,
  };
}

/**
 * Prepare and sanitize HTML to be rendered in sandboxed iframe:
 * - Adds <base href="..."> so relative paths resolve to the target host
 * - Injects a client navigation interception script that captures link clicks & form submits
 */
export function prepareHtmlForSandbox(html: string, currentUrl: string): string {
  try {
    const urlObj = new URL(currentUrl);
    const origin = urlObj.origin;
    const pathname = urlObj.pathname;
    const basePath = pathname.endsWith('/') ? pathname : pathname.substring(0, pathname.lastIndexOf('/') + 1) || '/';
    const baseUrl = `${origin}${basePath}`;

    // Script to intercept navigation inside iframe
    const interceptScript = `
      <script>
        (function() {
          // Intercept link clicks
          document.addEventListener('click', function(e) {
            var target = e.target;
            while (target && target.tagName !== 'A') {
              target = target.parentElement;
            }
            if (target && target.href && !target.href.startsWith('javascript:') && !target.href.startsWith('#')) {
              e.preventDefault();
              window.parent.postMessage({
                type: 'clouddesk-browser-navigate',
                url: target.href
              }, '*');
            }
          }, true);

          // Intercept form submissions
          document.addEventListener('submit', function(e) {
            var form = e.target;
            if (form && form.action) {
              e.preventDefault();
              var actionUrl = form.action;
              var method = (form.method || 'GET').toUpperCase();
              var formData = new FormData(form);
              var params = new URLSearchParams(formData).toString();
              if (method === 'GET') {
                var separator = actionUrl.indexOf('?') >= 0 ? '&' : '?';
                window.parent.postMessage({
                  type: 'clouddesk-browser-navigate',
                  url: actionUrl + separator + params
                }, '*');
              } else {
                window.parent.postMessage({
                  type: 'clouddesk-browser-submit',
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

    // Inject <base> and interceptScript inside <head> or at beginning
    let modifiedHtml = html;
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
