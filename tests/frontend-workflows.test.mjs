import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const tempOutDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sshdesktop-wf-test-'));
const apiStoreOut = path.join(tempOutDir, 'apiStore.mjs');
const secUtilsOut = path.join(tempOutDir, 'security-utils.mjs');

const tauriStubPlugin = {
  name: 'stub-tauri',
  setup(b) {
    b.onResolve({ filter: /^@tauri-apps\// }, (args) => ({
      path: args.path,
      namespace: 'tauri-stub',
    }));
    b.onLoad({ filter: /.*/, namespace: 'tauri-stub' }, () => ({
      contents: 'export const invoke = async () => { throw new Error("stub"); }; export const open = async () => {};',
      loader: 'js',
    }));
  },
};

function createStorageMock() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(String(k), String(v)); },
    removeItem: (k) => { m.delete(String(k)); },
    clear: () => { m.clear(); },
  };
}

globalThis.localStorage = createStorageMock();
globalThis.sessionStorage = createStorageMock();
globalThis.window = {
  location: { origin: 'http://localhost:9000', protocol: 'http:' },
  dispatchEvent: () => true,
  CustomEvent: class CustomEvent { constructor(name, opts) { this.type = name; this.detail = opts?.detail; } },
};
globalThis.CustomEvent = globalThis.window.CustomEvent;

await Promise.all([
  build({
    entryPoints: [path.resolve('src/apps/api/apiStore.ts')],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    outfile: apiStoreOut,
    plugins: [tauriStubPlugin],
  }),
  build({
    entryPoints: [path.resolve('src/lib/security-utils.ts')],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    outfile: secUtilsOut,
  }),
]);

const { useApiStore } = await import(pathToFileURL(apiStoreOut).href);
const secUtils = await import(pathToFileURL(secUtilsOut).href);

test('API Studio store workflow creates collections, saves requests, and exports sanitized bundles', () => {
  const store = useApiStore.getState();
  store.createCollection('Enterprise Prod', 'Core endpoints');
  const col = useApiStore.getState().collections.find((c) => c.name === 'Enterprise Prod');
  assert.ok(col);

  store.updateActiveTab({
    name: 'Health Check',
    method: 'GET',
    url: 'https://api.internal.local/health',
    headers: [
      { id: 'h1', key: 'Authorization', value: 'Bearer secret-jwt-token-99', enabled: true },
      { id: 'h2', key: 'Accept', value: 'application/json', enabled: true },
    ],
    auth: {
      type: 'bearer',
      bearerToken: 'secret-jwt-token-99',
      basicUser: '',
      basicPass: '',
      apiKeyName: '',
      apiKeyValue: '',
      apiKeyIn: 'header',
    },
  });
  store.saveToCollection(col.id, 'Health Check');

  const exported = JSON.parse(useApiStore.getState().exportSanitizedBundle());
  assert.equal(exported.schema, 'sshdesktop-api-bundle-v1');
  const req = exported.collections[0].requests[0];
  assert.equal(req.headers[0].value, '[REDACTED_SECRET]');
  assert.equal(req.headers[1].value, 'application/json');
  assert.equal(req.auth.bearerToken, '[REDACTED_SECRET]');
});

test('Performance check: redactSensitiveLogText processes 5,000 log lines quickly without stalling', () => {
  const lines = Array.from({ length: 5000 }, (_, i) =>
    `2026-11-11T12:00:00Z api[${i}] Authorization: Bearer secret_tok_${i}_abcdef postgres://svc:pw${i}@db/prod`
  );
  const started = performance.now();
  const output = lines.map((l) => secUtils.redactSensitiveLogText(l));
  const elapsedMs = performance.now() - started;

  assert.equal(output.length, 5000);
  assert.equal(output[123].includes('secret_tok_123_abcdef'), false);
  assert.equal(output[123].includes('pw123'), false);
  assert.ok(elapsedMs < 1500, `Expected 5,000-line redaction under 1500ms, took ${elapsedMs.toFixed(1)}ms`);
});
