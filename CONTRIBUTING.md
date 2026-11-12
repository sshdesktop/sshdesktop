# Contributing to SSH Desktop

Thank you for your interest in contributing to **SSH Desktop**! We welcome contributions from developers, security researchers, system administrators, and open-source enthusiasts worldwide.

This guide outlines our development workflow, architecture principles, security guidelines, and how to submit bug reports and pull requests.

---

## 🛠️ Prerequisites & Setup

SSH Desktop operates in dual-mode:
1. **Native Desktop Mode**: Tauri 2 + Rust + Webview
2. **Web / Headless Server Mode**: Node.js + Express / WebSockets

### Prerequisites
- **Node.js**: v20+ or v22+ LTS
- **Rust Toolchain**: Stable 1.78+ (`rustup default stable`)
- **Git**
- *(Linux only)* Tauri system dependencies:
  ```bash
  sudo apt-get install -y build-essential curl pkg-config libssl-dev libdbus-1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev libwebkit2gtk-4.1-dev
  ```

### Getting Started

```bash
# 1. Clone the repository
git clone https://github.com/sshdesktop/sshdesktop.git
cd sshdesktop

# 2. Switch to the dev branch (all feature work targets dev)
git checkout dev

# 3. Install npm dependencies
npm install

# 4. Run in Web Development Mode (fast frontend iteration)
npm run dev

# 5. Run in Native Desktop Mode (Tauri + Rust)
npm run tauri dev
```

---

## 🧪 Testing & Verification Matrix

Before submitting a Pull Request, all tests must pass cleanly:

```bash
# 1. ESLint (Zero warnings enforced)
npm run lint

# 2. TypeScript Typecheck
npx tsc --noEmit

# 3. Node Integration & Security Tests (26 test suites)
npm test

# 4. Rust Unit & Subsystem Tests (78 tests)
cargo test --manifest-path src-tauri/Cargo.toml

# 5. Full Production Build (Vite + tsc)
npm run build
```

---

## 🏛️ Core Architectural Invariants

### 1. Dual Runtime IPC Parity (100% Sync)
Every IPC command callable from the frontend must exist identically in:
- `src-tauri/src/main.rs` (Native Desktop)
- `server.js` (Web Server Mode)
- `src/lib/ipc-contract.ts` (`UNIFIED_COMMAND_CONTRACT`)

Automated contract tests (`tests/backend-contract.test.mjs`) verify this 100% parity on every CI run.

### 2. Strict Security Boundaries
- **No Plaintext Credential Persistence**: Passwords, private keys, and cloud secrets must **never** be stored in browser `localStorage` or `sessionStorage`. Use OS Keyring (Desktop) or the AES-256-GCM Vault (Web).
- **POSIX Shell Quoting**: Never interpolate untrusted strings directly into shell execution strings. Always use `sq(...)` or single-quoted escaping with `--` argument terminators:
  ```typescript
  const sq = (s: string) => "'" + String(s).replace(/'/g, "'\\''") + "'";
  const cmd = `rm -rfv -- ${sq(filename)}`;
  ```
- **Strict Input Validation**: All domain names, ports, IP addresses, usernames, and filesystem paths must be validated with regex / parsing before command execution.
- **Audit Logging**: Sensitive mutations (firewall rules, user modifications, database execution, backup exports) must generate an audit log entry verified via cryptographic hash chaining.

---

## 🌿 Git Branching & Pull Requests

1. **Base Branch**: Always branch off and open pull requests against the `dev` branch. `main` is reserved for tagged stable production releases.
2. **Branch Naming**:
   - `feat/feature-name`
   - `fix/bug-description`
   - `docs/documentation-update`
   - `perf/optimization`
3. **Commit Messages**: Follow [Conventional Commits](https://www.conventionalcommits.org/):
   - `feat(security): add hardware security key support`
   - `fix(docker): prevent container name option collision`
   - `test(database): add postgres view definition test`

---

## 🛡️ Security Vulnerabilities

If you discover a security vulnerability in SSH Desktop, please **do not** open a public GitHub issue. Instead, report it confidentially via GitHub Security Advisories or email the maintainers directly.

---

## 💬 Community & Help

- **Discussions & Issues**: Use GitHub Issues for bug reports and feature proposals.
- **Website & Demo**: [https://sshdesktop.com](https://sshdesktop.com)
