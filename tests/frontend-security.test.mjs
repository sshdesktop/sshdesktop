import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const tempOutDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sshdesktop-fe-test-'));
const outFile = path.join(tempOutDir, 'tauri-bridge.mjs');
const secUtilsOutFile = path.join(tempOutDir, 'security-utils.mjs');
const dockerSvcOutFile = path.join(tempOutDir, 'docker-service.mjs');
const certbotOutFile = path.join(tempOutDir, 'certbot-service.mjs');

await build({
  entryPoints: [path.resolve('src/apps/ssl/certbot-service.ts')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  outfile: certbotOutFile,
  external: ['@tauri-apps/*'],
  plugins: [
    {
      name: 'stub-tauri',
      setup(b) {
        b.onResolve({ filter: /^@tauri-apps\// }, (args) => ({
          path: args.path,
          namespace: 'tauri-stub',
        }));
        b.onLoad({ filter: /.*/, namespace: 'tauri-stub' }, () => ({
          contents: 'export const invoke = async () => ({ exit_code: 0, stdout: "", stderr: "" }); export const open = async () => {}; export const save = async () => null;',
          loader: 'js',
        }));
      },
    },
  ],
});

await build({
  entryPoints: [path.resolve('src/apps/docker/docker-service.ts')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  outfile: dockerSvcOutFile,
});

await build({
  entryPoints: [path.resolve('src/lib/security-utils.ts')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  outfile: secUtilsOutFile,
});

await build({
  entryPoints: [path.resolve('src/lib/tauri-bridge.ts')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  outfile: outFile,
  external: ['@tauri-apps/*'],
  plugins: [
    {
      name: 'stub-tauri',
      setup(b) {
        b.onResolve({ filter: /^@tauri-apps\// }, (args) => ({
          path: args.path,
          namespace: 'tauri-stub',
        }));
        b.onLoad({ filter: /.*/, namespace: 'tauri-stub' }, () => ({
          contents: 'export const invoke = async () => { throw new Error("stub"); }; export const open = async () => {}; export const save = async () => null;',
          loader: 'js',
        }));
      },
    },
  ],
});

function createStorageMock() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(String(k), String(v)); },
    removeItem: (k) => { store.delete(String(k)); },
    clear: () => { store.clear(); },
  };
}

const mockLocalStorage = createStorageMock();
const mockSessionStorage = createStorageMock();
globalThis.localStorage = mockLocalStorage;
globalThis.sessionStorage = mockSessionStorage;
const dispatchedEvents = [];
globalThis.window = {
  location: { origin: 'http://localhost:9000', protocol: 'http:' },
  dispatchEvent: (event) => {
    dispatchedEvents.push(event);
    return true;
  },
  CustomEvent: class CustomEvent { constructor(name, opts) { this.type = name; this.detail = opts?.detail; } },
};
globalThis.CustomEvent = globalThis.window.CustomEvent;

const bridge = await import(pathToFileURL(outFile).href);
const secUtils = await import(pathToFileURL(secUtilsOutFile).href);
const dockerSvc = await import(pathToFileURL(dockerSvcOutFile).href);
const certbotSvc = await import(pathToFileURL(certbotOutFile).href);

test('getStoredSession scrubs legacy bearer tokens and expired sessions from storage', () => {
  mockLocalStorage.clear();
  mockSessionStorage.clear();
  const futureExpiry = Date.now() + 60_000;
  mockLocalStorage.setItem(
    bridge.AUTH_STORAGE_KEY,
    JSON.stringify({ username: 'admin', token: 'leaked-token-should-be-removed', expiresAt: futureExpiry }),
  );
  mockLocalStorage.setItem(bridge.LEGACY_AUTH_STORAGE_KEY, '{"token":"old"}');

  const session = bridge.getStoredSession();
  assert.equal(session?.username, 'admin');
  assert.equal(session?.token, undefined);

  const persisted = JSON.parse(mockLocalStorage.getItem(bridge.AUTH_STORAGE_KEY));
  assert.equal('token' in persisted, false);
  assert.equal(mockLocalStorage.getItem(bridge.LEGACY_AUTH_STORAGE_KEY), null);

  // Expired session is purged automatically
  mockLocalStorage.setItem(
    bridge.AUTH_STORAGE_KEY,
    JSON.stringify({ username: 'admin', expiresAt: Date.now() - 1000 }),
  );
  assert.equal(bridge.getStoredSession(), null);
  assert.equal(mockLocalStorage.getItem(bridge.AUTH_STORAGE_KEY), null);
});

test('getProxiedBrowserUrl builds gateway URLs cleanly and preserves special URLs', () => {
  assert.equal(bridge.getProxiedBrowserUrl('about:blank', 'srv-1'), 'about:blank');
  assert.equal(
    bridge.getProxiedBrowserUrl('http://127.0.0.1:8080/admin?tab=1#top', 'srv 1'),
    '/api/browser/gateway/srv%201/http/127.0.0.1:8080/admin?tab=1#top',
  );
  assert.equal(
    bridge.getProxiedBrowserUrl('localhost:3000', 'default'),
    '/api/browser/gateway/default/http/localhost:3000/',
  );
});

test('authLogin sends CSRF X-Requested-With header and TOTP code to /api/invoke', async () => {
  let capturedUrl = null;
  let capturedHeaders = null;
  let capturedBody = null;
  globalThis.fetch = async (url, init) => {
    capturedUrl = url;
    capturedHeaders = init.headers;
    capturedBody = JSON.parse(init.body);
    const payload = {
      result: { success: true, must_change_password: false, username: 'admin', mfa_required: false },
    };
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(payload),
      json: async () => payload,
    };
  };

  const res = await bridge.authLogin('admin', 'StrongPassword!123', '287082');
  assert.equal(capturedUrl, '/api/invoke');
  assert.equal(capturedHeaders['X-Requested-With'], 'SSHDesktop');
  assert.equal(capturedBody.cmd, 'auth_login');
  assert.equal(capturedBody.args.totpCode, '287082');
  assert.equal(res.success, true);
});

test('sshLaunchPutty rejects explicitly in Web Mode with UNSUPPORTED_IN_WEB_MODE', async () => {
  const errPayload = { error: 'UNSUPPORTED_IN_WEB_MODE: PuTTY launch is native-only.' };
  globalThis.fetch = async () => ({
    ok: false,
    status: 501,
    text: async () => JSON.stringify(errPayload),
    json: async () => errPayload,
  });

  await assert.rejects(() => bridge.sshLaunchPutty('srv-1'), /UNSUPPORTED_IN_WEB_MODE/);
});

test('redactSensitiveLogText masks bearer tokens, AWS keys, DB passwords, and PEM keys', () => {
  const sample = [
    'GET /auth Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc.def',
    'aws key AKIAIOSFODNN7EXAMPLE connecting postgres://app:SuperSecret99@db.local:5432/prod',
    'login failed password=mysecretpass api_key: tok_12345',
  ].join('\n');
  const redacted = secUtils.redactSensitiveLogText(sample);
  assert.equal(redacted.includes('eyJhbGci'), false);
  assert.equal(redacted.includes('AKIAIOSFODNN7EXAMPLE'), false);
  assert.equal(redacted.includes('SuperSecret99'), false);
  assert.equal(redacted.includes('mysecretpass'), false);
  assert.equal(redacted.includes('tok_12345'), false);
  assert.match(redacted, /Bearer \[REDACTED\]/);
  assert.match(redacted, /\[REDACTED_AWS_KEY\]/);
});

test('isSensitiveEnvKey, clampRequestTimeoutSeconds, and sanitizeApiBundleForExport enforce safe boundaries', () => {
  assert.equal(secUtils.isSensitiveEnvKey('DATABASE_PASSWORD'), true);
  assert.equal(secUtils.isSensitiveEnvKey('STRIPE_SECRET_KEY'), true);
  assert.equal(secUtils.isSensitiveEnvKey('PATH'), false);

  assert.equal(secUtils.clampRequestTimeoutSeconds(999), 120);
  assert.equal(secUtils.clampRequestTimeoutSeconds(-5, 30), 30);
  assert.equal(secUtils.clampRequestTimeoutSeconds(15), 15);

  const bundle = secUtils.sanitizeApiBundleForExport(
    [
      {
        id: 'c1',
        name: 'Prod API',
        requests: [
          {
            name: 'Login',
            headers: [
              { key: 'Authorization', value: 'Bearer live-secret-jwt' },
              { key: 'Accept', value: 'application/json' },
            ],
            auth: { type: 'bearer', bearerToken: 'live-secret-jwt', basicPass: 'pw', apiKeyValue: 'k' },
          },
        ],
      },
    ],
    [{ id: 'e1', name: 'Prod', variables: [{ key: 'API_TOKEN', value: 'secret-99' }, { key: 'HOST', value: 'api.local' }] }],
  );
  assert.equal(bundle.collections[0].requests[0].headers[0].value, '[REDACTED_SECRET]');
  assert.equal(bundle.collections[0].requests[0].headers[1].value, 'application/json');
  assert.equal(bundle.collections[0].requests[0].auth.bearerToken, '[REDACTED_SECRET]');
  assert.equal(bundle.environments[0].variables[0].value, '[REDACTED_SECRET]');
  assert.equal(bundle.environments[0].variables[1].value, 'api.local');
});

test('buildDockerRunCommand validates limits and quotes arguments safely', () => {
  const cmd = dockerSvc.buildDockerRunCommand({
    image: 'nginx:alpine',
    name: 'web-1',
    restart: 'unless-stopped',
    memoryLimit: '512m',
    cpuLimit: '1.5',
    pidsLimit: '256',
    ports: '8080:80',
  });
  assert.match(cmd, /--memory '512m'/);
  assert.match(cmd, /--cpus '1\.5'/);
  assert.match(cmd, /--pids-limit '256'/);
  assert.throws(() => dockerSvc.buildDockerRunCommand({ image: 'nginx', name: 'bad;id' }), /Invalid container name/);
  assert.throws(() => dockerSvc.buildDockerRunCommand({ image: 'nginx', memoryLimit: '512m;id' }), /Invalid memory limit/);
});

test('certbot-service validates domain names and email addresses and rejects command injection payloads', async () => {
  await assert.rejects(
    () => certbotSvc.issueCertificate('conn-1', {
      domains: 'example.com"; rm -rf /; echo "',
      email: 'admin@example.com',
      plugin: 'standalone',
      redirectHttps: true,
      dryRun: false,
    }),
    /Invalid domain name/
  );

  await assert.rejects(
    () => certbotSvc.issueCertificate('conn-1', {
      domains: 'example.com',
      email: 'admin@example.com"; id; echo "',
      plugin: 'standalone',
      redirectHttps: true,
      dryRun: false,
    }),
    /Invalid email address/
  );

  await assert.rejects(
    () => certbotSvc.generateSelfSignedCertificate('conn-1', {
      outputDir: '/tmp"; rm -rf /; echo "',
      domain: 'localhost',
      organization: 'Dev',
      country: 'US',
      validDays: 365,
    }),
    /Invalid output directory path/
  );

  await assert.rejects(
    () => certbotSvc.testSslDiagnostics('conn-1', 'example.com"; reboot; echo "'),
    /Invalid target domain/
  );
});

test('handleBridgeErrorEvents dispatches security alert on untrusted host key', () => {
  dispatchedEvents.length = 0;
  const err = bridge.parseAppError('SECURITY ALERT: REMOTE HOST IDENTIFICATION HAS CHANGED!', 'ssh_connect');
  bridge.handleBridgeErrorEvents('ssh_connect', { connId: 'server-1' }, err);
  const alertEvent = dispatchedEvents.find((e) => e.type === 'sshdesktop-security-alert');
  assert.ok(alertEvent, 'Expected sshdesktop-security-alert event');
  assert.equal(alertEvent.detail.connId, 'server-1');
  assert.equal(alertEvent.detail.code, 'HOST_KEY_UNTRUSTED');
});

test('handleBridgeErrorEvents dispatches disconnect events on connection loss', () => {
  dispatchedEvents.length = 0;
  const err = bridge.parseAppError('Connection closed by remote host', 'ssh_exec');
  bridge.handleBridgeErrorEvents('ssh_exec', { connId: 'server-1' }, err);
  const dropEvent = dispatchedEvents.find((e) => e.type === 'sshdesktop-ssh-disconnected');
  assert.ok(dropEvent, 'Expected sshdesktop-ssh-disconnected event');
  assert.equal(dropEvent.detail.connId, 'server-1');
});

test('terminalResize debounces identical dimension updates', async () => {
  let invokeCount = 0;
  globalThis.fetch = async () => {
    invokeCount++;
    return {
      ok: true,
      status: 200,
      json: async () => ({ result: null }),
      text: async () => JSON.stringify({ result: null }),
    };
  };

  await bridge.terminalResize('term-test-1', 24, 80);
  assert.equal(invokeCount, 1);
  // Re-invoking with identical dimensions should short-circuit and avoid redundant invoke
  await bridge.terminalResize('term-test-1', 24, 80);
  assert.equal(invokeCount, 1);
  // Different dimensions trigger invoke
  await bridge.terminalResize('term-test-1', 30, 100);
  assert.equal(invokeCount, 2);
  await bridge.terminalClose('term-test-1');
});
