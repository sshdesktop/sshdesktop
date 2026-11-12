import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const EXPECTED_24_APPS = [
  'api',
  'automation',
  'browser',
  'cron',
  'database',
  'disk',
  'docker',
  'editor',
  'env',
  'filemanager',
  'firewall',
  'logs',
  'monitor',
  'network',
  'notes',
  'packages',
  'processes',
  'security',
  'services',
  'settings',
  'ssh',
  'ssl',
  'terminal',
  'users',
];

test('All 24 application directories exist and are lazy-loaded in WindowManager', () => {
  const appsDir = path.resolve('src/apps');
  const actualDirs = fs
    .readdirSync(appsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  assert.deepEqual(actualDirs, [...EXPECTED_24_APPS].sort());

  const windowMgr = fs.readFileSync(path.resolve('src/shell/WindowManager.tsx'), 'utf8');
  for (const appName of EXPECTED_24_APPS) {
    assert.match(windowMgr, new RegExp(`\\.\\./apps/${appName}/`), `App '${appName}' missing lazy import in WindowManager.tsx`);
  }
});

test('Zero plaintext password/secret persistence patterns in database or docker modules', () => {
  const checkedFiles = [
    'src/apps/database/DatabaseHub.tsx',
    'src/apps/docker/DockerManager.tsx',
    'src/shell/WebAuthGate.tsx',
    'src/lib/tauri-bridge.ts',
  ];
  for (const rel of checkedFiles) {
    const src = fs.readFileSync(path.resolve(rel), 'utf8');
    assert.equal(src.includes("localStorage.setItem('sshdesktop_custom_pwd'"), false, `${rel} must never persist sshdesktop_custom_pwd`);
  }

  const othersRs = fs.readFileSync(path.resolve('src-tauri/src/database/others.rs'), 'utf8');
  assert.equal(othersRs.includes('requires Oracle Instant Client'), true, 'Oracle must fail closed when SDK is absent');
  assert.equal(othersRs.includes('requires IBM Db2 CLI'), true, 'DB2 must fail closed when CLI is absent');
});
