import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const tempOutDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sshdesktop-contract-'));
const contractOut = path.join(tempOutDir, 'ipc-contract.mjs');

await build({
  entryPoints: [path.resolve('src/lib/ipc-contract.ts')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  outfile: contractOut,
});

const contract = await import(pathToFileURL(contractOut).href);

function extractRustHandlerCommands() {
  const mainRs = fs.readFileSync(path.resolve('src-tauri/src/main.rs'), 'utf8');
  const start = mainRs.indexOf('tauri::generate_handler!');
  const end = mainRs.indexOf('.on_window_event', start);
  assert.ok(start > 0 && end > start, 'Could not locate tauri::generate_handler! block in main.rs');
  const block = mainRs.slice(start, end);
  const commands = new Set();
  for (const line of block.split('\n')) {
    const clean = line.split('//')[0].trim();
    const m = clean.match(/([a-z0-9_]+),$/);
    if (m) commands.add(m[1]);
  }
  return commands;
}

function extractNodeSwitchCommands() {
  const serverJs = fs.readFileSync(path.resolve('server.js'), 'utf8');
  const commands = new Set();
  for (const m of serverJs.matchAll(/case\s+'([a-z0-9_]+)':/g)) {
    commands.add(m[1]);
  }
  return commands;
}

test('Unified IPC command contract matches Rust main.rs and Node server.js 100%', () => {
  const rustCommands = extractRustHandlerCommands();
  const nodeCommands = extractNodeSwitchCommands();
  const contractCommands = new Set(Object.keys(contract.UNIFIED_COMMAND_CONTRACT));

  const missingInRust = [...contractCommands].filter((c) => !rustCommands.has(c));
  const missingInNode = [...contractCommands].filter((c) => !nodeCommands.has(c));
  const unregisteredRust = [...rustCommands].filter((c) => !contractCommands.has(c));

  assert.deepEqual(missingInRust, [], `Commands missing in src-tauri/src/main.rs: ${missingInRust.join(', ')}`);
  assert.deepEqual(missingInNode, [], `Commands missing in server.js: ${missingInNode.join(', ')}`);
  assert.deepEqual(unregisteredRust, [], `Rust commands missing from UNIFIED_COMMAND_CONTRACT: ${unregisteredRust.join(', ')}`);
});

test('parseAppError maps backend error signatures consistently across runtimes', () => {
  assert.equal(contract.parseAppError('POLICY_DENIED: Action blocked', 'firewall_reset').code, 'POLICY_DENIED');
  assert.equal(contract.parseAppError('UNSUPPORTED_IN_WEB_MODE: DB driver missing', 'db_connect', 501).code, 'UNSUPPORTED_IN_WEB_MODE');
  assert.equal(contract.parseAppError('Session expired', 'ssh_exec', 401).code, 'SESSION_EXPIRED');
  assert.equal(contract.parseAppError('CONFLICT_DETECTED: remote hash changed', 'sftp_write_text_file').code, 'CONFLICT_DETECTED');
  assert.equal(contract.parseAppError('PROCESS_IDENTITY_MISMATCH: PID reused', 'process_kill').code, 'PROCESS_IDENTITY_MISMATCH');
  assert.equal(contract.parseAppError('Operation timed out after 5000ms', 'ssh_exec').code, 'TIMEOUT');
});

test('withRetryAndTimeout retries transient failures, honors AbortSignal, and enforces timeout', async () => {
  let attempts = 0;
  const okResult = await contract.withRetryAndTimeout(
    async () => {
      attempts += 1;
      if (attempts < 2) throw new Error('ECONNREFUSED temporary blip');
      return 'connected';
    },
    { retries: 2, baseDelayMs: 50, timeoutMs: 2000 },
  );
  assert.equal(okResult, 'connected');
  assert.equal(attempts, 2);

  // Aborted caller cancels immediately without retry
  const ac = new AbortController();
  ac.abort();
  await assert.rejects(
    () => contract.withRetryAndTimeout(async () => 'never', { signal: ac.signal, retries: 2 }),
    (err) => err.code === 'CANCELLED',
  );
});
