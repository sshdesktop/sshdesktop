/**
 * Shared frontend security helpers for redacting secrets in logs,
 * masking sensitive environment variables, and sanitizing exported bundles.
 */

export function isSensitiveEnvKey(key: string): boolean {
  return /(?:secret|token|key|pass|pwd|auth|cred|private|dsn|signature|cert|webhook)/i.test(String(key || ''));
}

export function redactSensitiveLogText(text: string): string {
  return String(text || '')
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, '$1[REDACTED]')
    .replace(/\b(AKIA[0-9A-Z]{16})\b/g, '[REDACTED_AWS_KEY]')
    .replace(/([a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^:\s/@]+:)[^@\s/]+(@)/g, '$1[REDACTED]$2')
    .replace(
      /\b(password|passwd|pwd|secret|token|api_?key|access_?key|private_?key)\s*([=:])\s*([^\s,;'"`]+)/gi,
      '$1$2[REDACTED]',
    )
    .replace(
      /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
      '[REDACTED_PRIVATE_KEY]',
    );
}

export function clampRequestTimeoutSeconds(raw: number | undefined, fallback = 30): number {
  const num = Number(raw);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return Math.max(1, Math.min(120, Math.floor(num)));
}

export function sanitizeApiBundleForExport(collections: any[], environments: any[]): {
  schema: string;
  exportedAt: string;
  collections: any[];
  environments: any[];
} {
  const secretHeader = /^(?:authorization|proxy-authorization|x-api-key|api-key|x-auth-token|cookie|set-cookie)$/i;
  const sanitizeReq = (req: any) => {
    const copy = JSON.parse(JSON.stringify(req || {}));
    if (Array.isArray(copy.headers)) {
      copy.headers = copy.headers.map((h: any) =>
        h && secretHeader.test(String(h.key || '').trim())
          ? { ...h, value: '[REDACTED_SECRET]' }
          : h,
      );
    }
    if (copy.auth && typeof copy.auth === 'object') {
      if (copy.auth.bearerToken) copy.auth.bearerToken = '[REDACTED_SECRET]';
      if (copy.auth.basicPass) copy.auth.basicPass = '[REDACTED_SECRET]';
      if (copy.auth.apiKeyValue) copy.auth.apiKeyValue = '[REDACTED_SECRET]';
    }
    return copy;
  };
  return {
    schema: 'sshdesktop-api-bundle-v1',
    exportedAt: new Date().toISOString(),
    collections: (collections || []).map((col: any) => ({
      ...col,
      requests: Array.isArray(col?.requests) ? col.requests.map(sanitizeReq) : [],
    })),
    environments: (environments || []).map((env: any) => ({
      ...env,
      variables: Array.isArray(env?.variables)
        ? env.variables.map((v: any) =>
            v && isSensitiveEnvKey(v.key) ? { ...v, value: '[REDACTED_SECRET]' } : v,
          )
        : [],
    })),
  };
}
