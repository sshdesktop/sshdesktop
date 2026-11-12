## Summary
<!-- Describe the change, bug fix, or security hardening and link the tracked issue. -->

## Audit & Security Checklist
- [ ] Changes maintain parity across Rust Tauri commands (`src-tauri/src/`), Web server IPC (`server.js`), and `src/lib/ipc-contract.ts`.
- [ ] No plaintext secrets or credentials persisted in `localStorage`, unencrypted disk JSON, or audit logs.
- [ ] Destructive/privileged commands enforce server-side RBAC, approval/policy checks, and strict argument validation.
- [ ] SSH host key verification (`@revoked`, `@cert-authority`, custom ports) and tunnel/proxy bounds are preserved.

## Verification
- [ ] `npm run lint` passes with zero warnings (`--max-warnings 0`)
- [ ] `npm test` (`node --test tests/*.test.mjs`) passes all contract, security, integration, and workflow suites
- [ ] `npm run test:rust` (`cargo test --manifest-path src-tauri/Cargo.toml`) passes
- [ ] `npm run build` (`tsc && vite build`) passes cleanly
