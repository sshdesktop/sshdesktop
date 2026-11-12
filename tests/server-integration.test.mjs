import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sshdesktop-http-it-'));
process.env.SSHDESKTOP_LIB_ONLY = '1';
process.env.SSHDESKTOP_DATA_DIR = tempDataDir;

const {
  backendServer,
  base32Decode,
  computeTotpAt,
} = await import('../server.js');

await new Promise((resolve) => backendServer.listen(0, '127.0.0.1', resolve));
const { port } = backendServer.address();
const BASE = `http://127.0.0.1:${port}`;

test.after(() => {
  backendServer.close();
});

async function invokeHttp(cmd, args = {}, { cookie = '', bearer = '', referer = '', includeXrw = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (includeXrw) headers['X-Requested-With'] = 'SSHDesktop';
  if (cookie) headers['Cookie'] = cookie;
  if (bearer) headers['Authorization'] = `Bearer ${bearer}`;
  if (referer) headers['Referer'] = referer;
  const res = await fetch(`${BASE}/api/invoke`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ cmd, args }),
  });
  const text = await res.text();
  let json = {};
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, headers: res.headers, json };
}

test('HTTP Integration: /api/health, /api/sso/status, CSRF, and unauthenticated 401 enforcement', async () => {
  const healthRes = await fetch(`${BASE}/api/health`);
  assert.equal(healthRes.status, 200);
  const health = await healthRes.json();
  assert.equal(health.status, 'ok');
  assert.equal('activeSessions' in health, false);

  const ssoRes = await fetch(`${BASE}/api/sso/status`);
  assert.equal(ssoRes.status, 200);
  const sso = await ssoRes.json();
  assert.equal(sso.enabled, false);

  // Missing X-Requested-With blocked by CSRF guard
  const missingXrw = await invokeHttp('auth_get_status', {}, { includeXrw: false });
  assert.equal(missingXrw.status, 403);

  // Browser gateway referer blocked even with X-Requested-With
  const gwRef1 = await invokeHttp('auth_get_status', {}, { referer: `${BASE}/s/sess1/index.html` });
  assert.equal(gwRef1.status, 403);
  const gwRef2 = await invokeHttp('auth_get_status', {}, { referer: `${BASE}/api/browser/gateway/srv1/http/evil/p` });
  assert.equal(gwRef2.status, 403);

  // Protected command without session returns 401 SESSION_EXPIRED
  const unauth = await invokeHttp('policy_get_mode', {});
  assert.equal(unauth.status, 401);
  assert.equal(unauth.json.code, 'SESSION_EXPIRED');
});

test('HTTP Integration: Full admin login, HttpOnly cookie, TOTP 2FA, team RBAC, API tokens, vault rotation, and command approvals', async () => {
  const credText = fs.readFileSync(path.join(tempDataDir, 'initial-admin-credentials.txt'), 'utf8');
  const pwMatch = credText.match(/Password:\s*(\S+)/i);
  assert.ok(pwMatch && pwMatch[1], 'Bootstrap password file must contain generated password');
  const initialPassword = pwMatch[1];

  const loginRes = await invokeHttp('auth_login', { username: 'admin', password: initialPassword });
  assert.equal(loginRes.status, 200);
  assert.equal(loginRes.json.result.success, true);
  assert.equal(loginRes.json.result.token, undefined); // Raw session token never leaked to JSON body
  const setCookie = loginRes.headers.get('set-cookie') || '';
  assert.match(setCookie, /sshdesktop_session=[^;]+/);
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Strict/i);
  const adminCookie = setCookie.split(';')[0];

  // Enable RFC 6238 TOTP MFA and verify login enforces it
  const totpSetup = await invokeHttp('auth_totp_setup', {}, { cookie: adminCookie });
  assert.equal(totpSetup.status, 200);
  const secret = totpSetup.json.result.secret;
  const otpNow = computeTotpAt(base32Decode(secret), Math.floor(Date.now() / 1000));
  const enableTotp = await invokeHttp('auth_totp_enable', { secret, code: otpNow }, { cookie: adminCookie });
  assert.equal(enableTotp.status, 200);
  assert.equal(enableTotp.json.result, true);

  const mfaPrompt = await invokeHttp('auth_login', { username: 'admin', password: initialPassword });
  assert.equal(mfaPrompt.json.result.success, false);
  assert.equal(mfaPrompt.json.result.mfa_required, true);

  const mfaValid = await invokeHttp('auth_login', { username: 'admin', password: initialPassword, totpCode: otpNow });
  assert.equal(mfaValid.json.result.success, true);

  // Team management: add read_only user, login as user, confirm RBAC denies mutations
  const addedTeam = await invokeHttp('team_add', { username: 'auditor1', password: 'AuditorPassword!2026', role: 'read_only' }, { cookie: adminCookie });
  assert.equal(addedTeam.status, 200);
  assert.equal(addedTeam.json.result.role, 'read_only');

  const teamLogin = await invokeHttp('auth_login', { username: 'auditor1', password: 'AuditorPassword!2026' });
  assert.equal(teamLogin.json.result.success, true);
  const auditorCookie = (teamLogin.headers.get('set-cookie') || '').split(';')[0];
  const auditorDenied = await invokeHttp('firewall_add_rule', { port: '443', protocol: 'tcp', action: 'allow' }, { cookie: auditorCookie });
  assert.equal(auditorDenied.status, 403);
  assert.match(auditorDenied.json.error, /POLICY_DENIED/);

  // Scoped API token authentication (Bearer header)
  const tokCreated = await invokeHttp('tokens_create', { name: 'ci-op', role: 'operator', expiresInDays: 30 }, { cookie: adminCookie });
  assert.equal(tokCreated.status, 200);
  const bearerTok = tokCreated.json.result.token;
  assert.ok(bearerTok.startsWith('sshdesktop_tok_'));

  const opRead = await invokeHttp('runtime_capabilities', {}, { bearer: bearerTok });
  assert.equal(opRead.status, 200);
  assert.equal(opRead.json.result.features.team_management, true);

  const opDeniedTokenMint = await invokeHttp('tokens_create', { name: 'esc', role: 'admin' }, { bearer: bearerTok });
  assert.equal(opDeniedTokenMint.status, 403);
  assert.match(opDeniedTokenMint.json.error, /POLICY_DENIED/);

  // Vault secret round-trip + key rotation over HTTP
  await invokeHttp('store_secret_save', { key: 'db-profile:it:password', value: 'VaultSecret!99' }, { cookie: adminCookie });
  const rotated = await invokeHttp('vault_rotate_key', {}, { cookie: adminCookie });
  assert.equal(rotated.json.result.rotated, true);
  const loadedSecret = await invokeHttp('store_secret_load', { key: 'db-profile:it:password' }, { cookie: adminCookie });
  assert.equal(loadedSecret.json.result, 'VaultSecret!99');

  // Command approval workflow + Terminal .cast recording round-trip
  const apReq = await invokeHttp('approval_request', { action: 'firewall_reset', target: 'prod-1', reason: 'CHG-101' }, { cookie: auditorCookie });
  assert.equal(apReq.status, 200);
  const apDecided = await invokeHttp('approval_decide', { id: apReq.json.result.id, decision: 'approved' }, { cookie: adminCookie });
  assert.equal(apDecided.json.result.status, 'approved');

  const savedCast = await invokeHttp('recordings_save', { title: 'Audit Test', host: 'prod-1', content_cast: '{"version":2}\n[0.1,"o","id\\r\\n"]\n' }, { cookie: adminCookie });
  assert.equal(savedCast.status, 200);
  const loadedCast = await invokeHttp('recordings_get', { id: savedCast.json.result.id }, { cookie: adminCookie });
  assert.match(loadedCast.json.result, /"version":2/);

  // SIEM export in CEF, Syslog, and NDJSON formats
  const cefExport = await invokeHttp('audit_export_siem', { format: 'cef' }, { cookie: adminCookie });
  assert.equal(cefExport.status, 200);
  assert.match(cefExport.json.result, /CEF:0\|SSHDesktop/);

  const syslogExport = await invokeHttp('audit_export_siem', { format: 'syslog' }, { cookie: adminCookie });
  assert.equal(syslogExport.status, 200);
  assert.match(syslogExport.json.result, /sshdesktop/);

  const ndjsonExport = await invokeHttp('audit_export_siem', { format: 'ndjson' }, { cookie: adminCookie });
  assert.equal(ndjsonExport.status, 200);
  assert.match(ndjsonExport.json.result, /\{/);

  // Validation & typed web-mode errors
  const nativeDbErr = await invokeHttp('db_execute_query', { connectionId: 'x', query: 'SELECT 1' }, { cookie: adminCookie });
  assert.equal(nativeDbErr.status, 501);
  assert.match(nativeDbErr.json.error, /UNSUPPORTED_IN_WEB_MODE/);

  const unknownCmd = await invokeHttp('nonexistent_cmd_xyz', {}, { cookie: adminCookie });
  assert.equal(unknownCmd.status, 400);
  assert.match(unknownCmd.json.error, /UNKNOWN_COMMAND/);
});
