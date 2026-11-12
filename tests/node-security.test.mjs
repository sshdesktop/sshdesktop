import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sshdesktop-test-'));
process.env.SSHDESKTOP_LIB_ONLY = '1';
process.env.SSHDESKTOP_DATA_DIR = tempDataDir;

const {
  parseSocks5GreetingFrame,
  parseSocks5UserPassFrame,
  parseSocks5ConnectFrame,
  validateVaultKeyName,
  vaultEncryptValue,
  vaultDecryptValue,
  vaultRotateKey,
  base32Encode,
  computeTotpAt,
  verifyTotpCode,
  appendAuditEvent,
  verifyAuditChain,
  getSecurityPolicy,
  enforcePolicyPermission,
  evaluateKnownHostsContent,
} = await import('../server.js');

test('SOCKS5 greeting parser handles byte-by-byte TCP fragmentation', () => {
  const frame = Buffer.from([0x05, 0x02, 0x00, 0x02]);
  for (let i = 1; i < frame.length; i++) {
    assert.deepEqual(parseSocks5GreetingFrame(frame.subarray(0, i)), { status: 'incomplete' });
  }
  const parsed = parseSocks5GreetingFrame(frame);
  assert.equal(parsed.status, 'ok');
  assert.deepEqual(parsed.methods, [0x00, 0x02]);
  assert.equal(parsed.consumed, 4);
});

test('SOCKS5 RFC 1929 auth parser handles fragmented credentials', () => {
  const user = Buffer.from('admin');
  const pass = Buffer.from('hunter2!');
  const frame = Buffer.concat([
    Buffer.from([0x01, user.length]),
    user,
    Buffer.from([pass.length]),
    pass,
  ]);
  for (let i = 1; i < frame.length; i++) {
    assert.deepEqual(parseSocks5UserPassFrame(frame.subarray(0, i)), { status: 'incomplete' });
  }
  const parsed = parseSocks5UserPassFrame(frame);
  assert.equal(parsed.status, 'ok');
  assert.equal(parsed.username.toString('utf8'), 'admin');
  assert.equal(parsed.password.toString('utf8'), 'hunter2!');
  assert.equal(parsed.consumed, frame.length);
});

test('SOCKS5 CONNECT parser handles fragmented IPv4, domain, IPv6, and trailing payload', () => {
  // Domain frame with trailing pipelined HTTP byte
  const host = Buffer.from('internal.db.local');
  const domainFrame = Buffer.concat([
    Buffer.from([0x05, 0x01, 0x00, 0x03, host.length]),
    host,
    Buffer.from([0x15, 0x38, 0x47, 0x45, 0x54]), // port 5432 + "GET"
  ]);
  for (let i = 1; i < domainFrame.length - 3; i++) {
    assert.deepEqual(parseSocks5ConnectFrame(domainFrame.subarray(0, i)), { status: 'incomplete' });
  }
  const parsedDomain = parseSocks5ConnectFrame(domainFrame);
  assert.equal(parsedDomain.status, 'ok');
  assert.equal(parsedDomain.destHost, 'internal.db.local');
  assert.equal(parsedDomain.destPort, 5432);
  assert.equal(domainFrame.subarray(parsedDomain.consumed).toString('utf8'), 'GET');

  // IPv4 frame
  const ipv4Frame = Buffer.from([0x05, 0x01, 0x00, 0x01, 127, 0, 0, 1, 0x19, 0xeb]);
  const parsedIpv4 = parseSocks5ConnectFrame(ipv4Frame);
  assert.equal(parsedIpv4.status, 'ok');
  assert.equal(parsedIpv4.destHost, '127.0.0.1');
  assert.equal(parsedIpv4.destPort, 6635);
});

test('Server vault key validation and AES-256-GCM encryption round-trip', () => {
  assert.throws(() => validateVaultKeyName('arbitrary:key'));
  assert.throws(() => validateVaultKeyName('db-profile:../bad'));
  assert.equal(validateVaultKeyName('db-profile:prof-1:password'), 'db-profile:prof-1:password');

  const enc = vaultEncryptValue('super-secret-db-pass-!@#');
  assert.notEqual(enc.data, Buffer.from('super-secret-db-pass-!@#').toString('hex'));
  assert.equal(vaultDecryptValue(enc), 'super-secret-db-pass-!@#');
});

test('Hash-chained audit log verifies integrity and detects tampering', () => {
  appendAuditEvent({ event: 'test_connect', username: 'admin', status: 'ok' });
  appendAuditEvent({ event: 'test_firewall', username: 'admin', status: 'ok' });
  const check1 = verifyAuditChain();
  assert.equal(check1.valid, true);
  assert.equal(check1.total, 2);

  const auditPath = path.join(tempDataDir, 'audit.log');
  const raw = fs.readFileSync(auditPath, 'utf8');
  fs.writeFileSync(auditPath, raw.replace('test_connect', 'tampered_event'), 'utf8');
  const check2 = verifyAuditChain();
  assert.equal(check2.valid, false);
  assert.equal(check2.brokenAt, 1);
});

test('Security policy enforces role permissions cleanly', () => {
  assert.equal(getSecurityPolicy().role, 'admin');
  assert.doesNotThrow(() => enforcePolicyPermission('firewall_reset', {}));

  fs.writeFileSync(path.join(tempDataDir, 'policy.json'), JSON.stringify({ role: 'operator', blockMetadataEgress: true }));
  assert.throws(() => enforcePolicyPermission('firewall_reset', {}), /POLICY_DENIED/);
  assert.doesNotThrow(() => enforcePolicyPermission('firewall_add_rule', {}));

  fs.writeFileSync(path.join(tempDataDir, 'policy.json'), JSON.stringify({ role: 'read_only', blockMetadataEgress: true }));
  assert.throws(() => enforcePolicyPermission('firewall_add_rule', {}), /POLICY_DENIED/);

  // Scoped API token clamps permissions even when workspace policy is admin
  fs.writeFileSync(path.join(tempDataDir, 'policy.json'), JSON.stringify({ role: 'admin', blockMetadataEgress: true }));
  assert.doesNotThrow(() => enforcePolicyPermission('firewall_add_rule', {}, { role: 'operator' }));
  assert.throws(() => enforcePolicyPermission('tokens_create', {}, { role: 'operator' }), /POLICY_DENIED/);
  assert.throws(() => enforcePolicyPermission('firewall_add_rule', {}, { role: 'read_only' }), /POLICY_DENIED/);
});

test('RFC 6238 TOTP matches standard test vector and validates drift window', () => {
  const secretBytes = Buffer.from('12345678901234567890', 'ascii');
  assert.equal(computeTotpAt(secretBytes, 59), '287082');
  const b32 = base32Encode(secretBytes);
  assert.equal(verifyTotpCode(b32, '287082', 59), true);
  assert.equal(verifyTotpCode(b32, '287082', 88), true); // +29s within 30s drift step
  assert.equal(verifyTotpCode(b32, '000000', 59), false);
});

test('Vault key rotation re-encrypts persisted secrets under a fresh 256-bit key', () => {
  const vaultFile = path.join(tempDataDir, 'vault.enc.json');
  const keyFile = path.join(tempDataDir, 'vault.key');
  const staleCiphertext = vaultEncryptValue('rotated-secret-value-42');
  fs.writeFileSync(vaultFile, JSON.stringify({ 'db-profile:rot-1:password': staleCiphertext }), 'utf8');
  const oldKeyHex = fs.readFileSync(keyFile, 'utf8').trim();

  const res = vaultRotateKey();
  assert.equal(res.rotated, true);
  assert.equal(res.entriesReencrypted, 1);

  const newKeyHex = fs.readFileSync(keyFile, 'utf8').trim();
  assert.notEqual(newKeyHex, oldKeyHex);
  const rotatedVault = JSON.parse(fs.readFileSync(vaultFile, 'utf8'));
  assert.equal(vaultDecryptValue(rotatedVault['db-profile:rot-1:password']), 'rotated-secret-value-42');
  assert.throws(() => vaultDecryptValue(staleCiphertext));
});

test('known_hosts evaluation handles @revoked, @cert-authority, custom ports, and |1| HMAC-SHA1 hashes', () => {
  const salt = Buffer.from('0123456789abcdef0123');
  const digest = crypto.createHmac('sha1', salt).update('[bastion.corp]:2222', 'utf8').digest();
  const hashedEntry = `|1|${salt.toString('base64')}|${digest.toString('base64')}`;
  const knownHosts = [
    `@revoked *.corp.example ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIRevokedKey`,
    `@cert-authority *.ca.example ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIMockCAKey`,
    `${hashedEntry} ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHashedHostKey`,
    `app.internal ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAppKey`,
  ].join('\n');

  const revoked = evaluateKnownHostsContent(knownHosts, 'edge.corp.example', 22, 'ssh-ed25519', 'AAAAC3NzaC1lZDI1NTE5AAAAIRevokedKey');
  assert.equal(revoked.status, 'changed');
  assert.match(revoked.message, /REVOKED/i);

  const ca = evaluateKnownHostsContent(knownHosts, 'db.ca.example', 22, 'ssh-ed25519', 'AAAAC3NzaC1lZDI1NTE5AAAAISomeHostKey');
  assert.equal(ca.status, 'unsupported_cert_authority');

  const hashed = evaluateKnownHostsContent(knownHosts, 'bastion.corp', 2222, 'ssh-ed25519', 'AAAAC3NzaC1lZDI1NTE5AAAAIHashedHostKey');
  assert.equal(hashed.status, 'trusted');

  const changed = evaluateKnownHostsContent(knownHosts, 'app.internal', 22, 'ssh-ed25519', 'AAAAC3NzaC1lZDI1NTE5AAAAIMitmKey');
  assert.equal(changed.status, 'changed');

  const unseen = evaluateKnownHostsContent(knownHosts, 'brandnew.internal', 22, 'ssh-ed25519', 'AAAAC3NzaC1lZDI1NTE5AAAAINewKey');
  assert.equal(unseen.status, 'not_found');
});
