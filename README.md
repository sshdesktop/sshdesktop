# SSH Desktop

<p align="center">
  <img src="src-tauri/icons/128x128.png" alt="SSH Desktop Logo" width="100" height="100" />
</p>

<p align="center">
  <strong>The Agentless, Enterprise-Grade Remote Linux Desktop & Server Management OS</strong>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-Apache%202.0-blue.svg" alt="License" /></a>
  <a href="https://tauri.app/"><img src="https://img.shields.io/badge/Tauri-2.0-24C8DB.svg?logo=tauri&logoColor=white" alt="Tauri 2" /></a>
  <a href="https://www.rust-lang.org/"><img src="https://img.shields.io/badge/Rust-2021%20Edition-DEA584.svg?logo=rust&logoColor=white" alt="Rust" /></a>
  <a href="https://react.dev/"><img src="https://img.shields.io/badge/React-19-61DAFB.svg?logo=react&logoColor=black" alt="React 19" /></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5.x-3178C6.svg?logo=typescript&logoColor=white" alt="TypeScript" /></a>
  <a href="https://tailwindcss.com/"><img src="https://img.shields.io/badge/Tailwind-CSS%203-38B2AC.svg?logo=tailwind-css&logoColor=white" alt="Tailwind CSS" /></a>
</p>

---

## 🌟 Overview

**SSH Desktop** transforms any remote Linux server into an authentic, interactive macOS-inspired desktop operating system running directly on your client computer.

Unlike Webmin, Cockpit, or traditional management dashboards, **SSH Desktop is 100% agentless**. You do not need to install daemon processes, open HTTP/HTTPS ports, run background node agents, or expose insecure web interfaces on your server. All system telemetry, file transfers, container controls, and service management are tunneled transparently through standard, encrypted **SSH2 (port 22)** channels.

Whether you are managing a single Ubuntu VPS, an enterprise fleet of RHEL/CentOS servers, or edge devices across multiple data centers, SSH Desktop gives you the power of a modern desktop environment with zero server-side footprint.

---

## 🏛️ Architecture

SSH Desktop utilizes a two-tier high-performance architecture:
- **Client Native Layer**: Built on **Tauri 2.0** and **Rust** (`ssh2`, `portable-pty`, `tokio`). Manages raw SSH transport, encrypted PTY multiplexing, high-throughput SFTP streaming, elevation fallbacks, and local file caching.
- **Client Interface Shell**: Built on **React 19**, **TypeScript**, and **Tailwind CSS**. A glassmorphic macOS desktop shell complete with window management, menu bars, dock, mission control, notifications, and dedicated system apps.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        SSH DESKTOP CLIENT                              │
├────────────────────────────────────────────────────────────────────────┤
│  React 19 Desktop Shell                                                │
│  ├─ Window Manager (Z-index, Snap, Maximize, Minimized Dock)          │
│  ├─ Multi-Server Fleet Matrix & Target Selector                        │
│  └─ 19 Integrated System & DevOps Applications                         │
├────────────────────────────────────────────────────────────────────────┤
│  Tauri 2.0 IPC Bridge (Type-safe Invoke API)                           │
├────────────────────────────────────────────────────────────────────────┤
│  Rust SSH2 Engine (Multi-Session Multiplexer)                          │
│  ├─ Direct SSH Exec & Stream Channels                                  │
│  ├─ Elevated Sudo Tempfile & Stdin Pipes                               │
│  ├─ High-Throughput SFTP Streamer                                      │
│  └─ Native Terminal PTY Sockets (PTY / TTY / ANSI / Raw Mode)          │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Encrypted Port 22 SSH Connection
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                  REMOTE LINUX SERVER (AGENTLESS)                       │
├────────────────────────────────────────────────────────────────────────┤
│  Standard Linux Stack (Ubuntu / Debian / RHEL / CentOS / Arch / etc.)  │
│  ├─ OpenSSH Daemon (sshd)                                              │
│  ├─ Systemd / Services                                                 │
│  ├─ Docker Daemon / Sockets                                            │
│  ├─ Local Database Instances (PostgreSQL / MySQL / Redis / SQLite)     │
│  └─ User Storage (~/.sshdesktop, ~/Desktop, ~/Downloads)               │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 🚀 Key Advantages

- 🛡️ **Zero Server Agent Required**: No npm packages, python scripts, docker containers, or background agents running on the server. Connect with a normal SSH key or password.
- ⚡ **Ultra-Fast & Memory Efficient**: Tauri + Rust binary uses a fraction of the RAM of typical Electron applications while delivering native 60fps desktop rendering.
- 🔐 **Privilege & Permission Boundary Protection**: Automatically detects user permissions (`root`, `sudo`, `wheel`, or standard user). Operations needing administrative privileges leverage elevated base64 pipe handlers with safety bounds.
- 🌐 **Enterprise Fleet Matrix**: Organize infrastructure hierarchically across **Organizations > Groups > Servers**. Execute parallel or rolling automations across multiple machines simultaneously.
- 💾 **Remote Persistence (`~/.sshdesktop`)**: User settings, stickies, bookmarks, and configurations sync seamlessly to the login user's home directory (`/home/<user>/.sshdesktop`) with 1-click backup, restore, and tar packaging.

---

## 📦 Integrated Applications Catalog

SSH Desktop ships with 19 full-featured native applications:

### 1. 📊 System Monitor
- Real-time CPU, RAM, Swap, Disk, and Network telemetry streaming.
- Live interactive process tree with sorting, CPU/Memory percentages, and priority.
- Send signals (`SIGTERM`, `SIGKILL`, `SIGHUP`) to runaway processes.
- Visual memory breakdown: Active, Cached, Buffers, and Free memory.

### 2. 📁 File Manager (Finder)
- Dual-pane navigation with breadcrumbs, grid view, list view, and tree navigation.
- SFTP upload, download, drag-and-drop, inline folder creation, and search.
- File permissions editor (`chmod` octal/symbolic and `chown` user:group).
- File cut, copy, duplicate with non-colliding names (`1.txt` ➔ `1 - Copy.txt`).
- Quick navigation bookmarks and hidden files toggle (`Ctrl+H` / `Cmd+H`).

### 3. 💻 Code Editor
- Integrated Monaco Editor (VS Code engine).
- Syntax highlighting and auto-completion for **80+ languages** (Rust, TypeScript, Python, Go, C++, SQL, Dockerfile, Nginx config, YAML, JSON, Shell script, etc.).
- Bottom status bar with 1-click **Language Mode Selector** and `Ctrl+K M` chord.
- Privileged file saving: edit root-protected system files (e.g. `/etc/nginx/nginx.conf`) safely via temporary base64 staging pipes.
- Integrated PTY terminal drawer with multiple tabs and folder navigation.

### 4. ⚡ Fleet Automation & Matrix
- Enterprise infrastructure hierarchy: **Organization ➔ Group ➔ Server**.
- Direct CRUD operations for servers, groups, and organizations inside the UI.
- Live server connectivity probes (real-time latency, active/inactive badges).
- Built-in Monaco recipe editor with environment interpolation (`{{SERVER_NAME}}`, `{{IP}}`).
- **Parallel** or **Rolling** batch execution across dozens of nodes with live output streaming.
- Comprehensive audit history with single-server and bundled multi-server report download (`.md` / `.log`).
- Custom **Delete Confirmation Alert Modals** protecting all infrastructure assets.

### 5. 🗄️ Database Studio
- Connects directly through the encrypted SSH tunnel to databases running on `localhost` or private networks.
- Full support for **PostgreSQL**, **MySQL / MariaDB**, **SQLite**, and **Redis**.
- Interactive query editor with syntax highlighting, execution duration, and table grid results.
- Schema browser: inspect databases, tables, columns, indexes, and keys.

### 6. 🐳 Docker & Container Manager
- Live container dashboard: start, stop, restart, pause, and kill containers.
- Container log streaming with ANSI color formatting and auto-scroll.
- Image management: inspect layers, pull new images from registries, and remove untagged images.
- Volumes and networks inspector.

### 7. 📦 Package Manager
- Universal package manager wrapper supporting **APT** (Debian/Ubuntu), **DNF/YUM** (RHEL/Fedora/CentOS), **Pacman** (Arch), **Zypper** (openSUSE), and **APK** (Alpine).
- Search repositories, view package metadata, dependencies, and install sizes.
- 1-click system upgrades (`apt update && apt upgrade -y`, `dnf update -y`).
- Installation and removal history logs.

### 8. ⚙️ Service Manager (Systemd)
- Comprehensive Systemd manager: list active, inactive, failed, and masked units.
- Filter by services, sockets, timers, targets, and mounts.
- Manage unit state: Start, Stop, Restart, Reload, Enable, and Disable on boot.
- Live journalctl log viewer for individual services.

### 9. 🛡️ Firewall Manager
- Multi-engine firewall management: **UFW** (Ubuntu/Debian), **Firewalld** (RHEL/CentOS), and **Iptables / NFTables**.
- View active listening ports and inbound/outbound rules.
- Add and delete custom rules: specify protocol (TCP/UDP), port ranges, and IP CIDR blocks.
- 1-click toggle for default incoming and outgoing policies.

### 10. 👥 User & Group Manager
- User account CRUD: create new users, modify login shells (`/bin/bash`, `/bin/zsh`, `/bin/sh`), and set passwords.
- **Cross-Distribution Administrative Privilege System**: Automatically detects whether target OS uses `sudo` (Ubuntu/Debian) or `wheel` (RHEL/CentOS/Fedora/Arch/Amazon Linux) and assigns privileges seamlessly.
- Account status locking/unlocking via shadow crypt inspection.
- Active user session inspector (`who`, `w`, `loginctl`, `ps`).

### 11. 💾 Disk Manager
- Filesystem partition layout, mount points, total/used/free space, and inode consumption.
- Visual disk usage bars with threshold alerts (>85% warning).
- Mount and unmount utilities.

### 12. 🌐 Network Manager
- Network interfaces listing with MAC addresses, IPv4/IPv6 assignments, and MTU.
- Active sockets and listening TCP/UDP ports with bound process IDs.
- Remote ping and DNS lookup diagnostic tools.

### 13. ⏱️ Cron Job Scheduler
- Inspect user crontabs and system cron directories (`/etc/cron.d`, `/etc/cron.daily`, etc.).
- Visual cron schedule generator with human-readable interval previews.
- Create, edit, and toggle periodic background jobs.

### 14. 🔒 SSL & Certbot Manager
- Inspect installed certificates in `/etc/letsencrypt/live` and `/etc/ssl`.
- Automated detection of Nginx and Apache Certbot plugins without slow system package scans.
- Issue Let's Encrypt certificates with dry-run testing.
- Built-in self-signed certificate generator with instant output display and key export.

### 15. 🧪 API Studio
- Full-featured REST & HTTP client running through the server environment.
- Method selector (`GET`, `POST`, `PUT`, `DELETE`, `PATCH`, `HEAD`).
- Headers, URL parameters, authentication, and JSON request bodies.
- Sync request collections and history to `~/.sshdesktop/api_studio.json`.

### 16. 🌍 Cloud Browser
- Embedded WebKit browser window for testing web applications, dashboards, or local services directly within the desktop shell.
- Bookmarks bar synced to remote `~/.sshdesktop/browser_bookmarks.json`.

### 17. ⚙️ App Settings & Backup/Restore
- Theme selector (Dark / Light / OLED Catppuccin themes).
- Authentic macOS Sonoma, Ventura, and Monterey dynamic wallpapers.
- Dock customizations: Position (Bottom / Left / Right), Auto-hide, and icon sizes.
- **Backup & Restore (~/.sshdesktop)**:
  - 1-click **Backup Now** to save all preferences to `<userHome>/.sshdesktop/settings.json`.
  - 1-click **Restore Now** to rehydrate preferences.
  - **Auto-Restore on User Login** toggle (`User Login OK`).
  - Full `.tar.gz` / `.tar` directory packaging, download to PC, and upload recovery.

### 18. 📟 Integrated Terminal
- Pure PTY Xterm.js terminal with raw ANSI escape code rendering.
- Full keyboard shortcut support (`Ctrl+C`, `Ctrl+V`, `Ctrl+A`).
- Right-click context menu (Copy Selection, Paste, Clear, Reset, Select All).
- Spawns multiple terminal tabs per connection.

### 19. 📝 Desktop Widgets & Stickies
- Interactive macOS-style sticky notes on the desktop wallpaper, auto-synced to `~/.sshdesktop/stickies.txt`.
- Desktop widget tray with live clock, active server badge, and telemetry stats.

---

## 🚀 Linux Server Standalone Single Binary Mode (Dual Engine 2222 / 2020)

In addition to the native desktop application, SSH Desktop can be deployed directly on any Linux server as a **single standalone binary executable** with **zero external dependencies**:

- **Frontend Web Desktop**: Port `2222` (interactive macOS desktop shell in your browser)
- **Backend API & SSH Engine**: Port `2020` (Node SEA SSH2 engine, reverse-proxied transparently)
- **Single Systemd Service**: Managed via `sshdesktop.service`

### Quick Run
```bash
# Download and run the single binary (no Node.js or npm needed)
chmod +x sshdesktop-linux-x64
./sshdesktop-linux-x64
```
Access at: `http://<YOUR_SERVER_IP>:2222`  
Default Login: `admin` / `sshdesktop`

### 24/7 Systemd Service Installation
```bash
sudo bash install.sh
```
Check status: `systemctl status sshdesktop`  
View live logs: `journalctl -u sshdesktop -f`

### Build Single Standalone Binary from Source
```bash
npm run build:binary
```

---

## 🛠️ Getting Started & Development

### Prerequisites

1. **Rust**: Latest stable toolchain (1.75+)
   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```
2. **Node.js**: Version 20.x or 22.x LTS
   ```bash
   # Verify version
   node -v
   npm -v
   ```
3. **OS-Specific Tauri Dependencies**:
   - **Linux (Ubuntu/Debian)**:
     ```bash
     sudo apt-get update
     sudo apt-get install -y build-essential curl wget file libssl-dev libgtk-3-dev \
       libayatana-appindicator3-dev librsvg2-dev libwebkit2gtk-4.1-dev patchelf
     ```
   - **macOS**: Xcode Command Line Tools (`xcode-select --install`)
   - **Windows**: Microsoft Visual Studio C++ Build Tools & WebView2 (pre-installed on Windows 10/11)

---

### Installation & Setup

1. **Clone the repository**:
   ```bash
   git clone https://github.com/sshdesktop/sshdesktop.git
   cd sshdesktop
   ```

2. **Install frontend dependencies**:
   ```bash
   npm install
   ```

3. **Run in development mode** (hot-reload frontend & live Rust rebuild):
   ```bash
   npm run tauri:dev
   ```

4. **Verify TypeScript compilation**:
   ```bash
   npx tsc --noEmit
   ```

5. **Fast production build** (Vite asset bundle check):
   ```bash
   npm run build:fast
   ```

6. **Build native desktop distribution package**:
   ```bash
   npm run tauri build
   ```
   Compiled installers will be placed in:
   - **Windows**: `src-tauri/target/release/bundle/nsis/*.exe` and `*.msi`
   - **Linux**: `src-tauri/target/release/bundle/deb/*.deb`, `*.rpm`, `*.AppImage`
   - **macOS**: `src-tauri/target/release/bundle/dmg/*.dmg`

---

## 🌿 Git Branching Model & CI/CD

SSH Desktop follows a streamlined branch lifecycle:

| Branch | Purpose | CI/CD Action Behavior |
|---|---|---|
| **`main`** | **Production Releases** | Automatically triggers the GitHub Actions multi-platform release pipeline (`.github/workflows/build.yml`) to compile and publish installers for Windows, Linux, and macOS. |
| **`dev`** | **Active Development** | Feature branches and ongoing code changes are pushed here. **GitHub Actions builds are suppressed on `dev`**, saving CI runner minutes and preventing premature releases. |

### Development Flow
```bash
# Checkout or create dev branch
git checkout dev

# Make changes, verify builds
npm run build:fast
npx tsc --noEmit

# Commit and push to dev
git add .
git commit -m "feat: description of improvement"
git push -u origin dev
```

---

## 📂 Project Structure

```
sshdesktop/
├── .github/
│   └── workflows/
│       └── build.yml             # Multi-platform CI/CD (Windows, Linux, macOS)
├── public/                       # Static public assets, wallpapers, and icons
├── src/                          # React 19 Frontend Shell
│   ├── apps/                     # 19 Dedicated Desktop Applications
│   │   ├── api/                  # API Studio (REST client)
│   │   ├── automation/           # Fleet Matrix & Parallel Runner
│   │   ├── browser/              # WebKit Browser
│   │   ├── cron/                 # Cron Job Manager
│   │   ├── database/             # Database Client (Postgres, MySQL, Redis, SQLite)
│   │   ├── disk/                 # Disk & Partition Manager
│   │   ├── docker/               # Docker Container & Image Manager
│   │   ├── editor/               # VS Code Monaco Editor (80+ languages)
│   │   ├── filemanager/          # SFTP Finder File Manager
│   │   ├── firewall/             # UFW / Firewalld Manager
│   │   ├── network/              # Network & Port Manager
│   │   ├── notes/                # Sticky Notes & Editor
│   │   ├── packages/             # APT / DNF / Pacman Package Manager
│   │   ├── services/             # Systemd Service Manager
│   │   ├── settings/             # Settings, Wallpapers, Backup & Restore
│   │   ├── ssh/                  # Server Profile & Credential Manager
│   │   ├── ssl/                  # SSL & Certbot Manager
│   │   ├── monitor/              # System Monitor & Telemetry
│   │   └── users/                # User & Group Manager
│   ├── components/               # Glassmorphic UI components, modals & alerts
│   ├── lib/                      # Tauri bridge, SFTP streamer, and stores
│   │   ├── store.ts              # Zustand core state
│   │   ├── permissions.ts        # Dynamic privilege evaluator
│   │   ├── server-backup.ts      # .tar / .tar.gz directory backup engine
│   │   ├── server-settings.ts    # ~/.sshdesktop settings sync engine
│   │   └── tauri-bridge.ts       # Type-safe Rust IPC wrapper
│   ├── shell/                    # macOS Glassmorphic Desktop Shell
│   │   ├── Desktop.tsx           # Window canvas, wallpaper, icon grid
│   │   ├── Dock.tsx              # Animated dock with running indicators
│   │   ├── Taskbar.tsx           # Top status menu bar
│   │   └── Window.tsx            # Drag, resize, snap, and minimize manager
│   ├── App.tsx                   # Main application entrypoint
│   └── main.tsx                  # React root mount
├── src-tauri/                    # Native Rust Engine (Tauri 2.0)
│   ├── src/
│   │   ├── ssh/                  # SSH2 connection pool, PTY socket, SFTP
│   │   ├── system/               # Native telemetry & user privilege probes
│   │   └── main.rs               # Tauri IPC command registration
│   ├── Cargo.toml                # Rust crate dependencies
│   └── tauri.conf.json           # Window configuration and app capabilities
├── package.json                  # Node dependencies & scripts
├── vite.config.ts                # Vite bundler configuration
└── LICENSE                       # Apache License 2.0
```

---

## 🔒 Security Architecture

1. **Zero-Agent Surface**: No listener daemon or open ports on your server. If standard OpenSSH is secure, SSH Desktop is secure.
2. **Encrypted Transport**: All traffic uses standard SSH2 cryptographic handshakes (Ed25519, ECDSA, RSA) with AES-GCM or ChaCha20-Poly1305 encryption.
3. **Elevated Privileges Boundary**: Operations requiring root privileges (saving system configs, managing services, editing users) never leave plain text passwords in shell history. Stdin pipes and one-time base64 streams are used with automated cleanup.
4. **Local Credential Storage**: SSH private keys, passphrases, and connection profiles are encrypted and stored locally on your client machine.

---

## 📄 License

SSH Desktop is an open-source project licensed under the **Apache License, Version 2.0**.

```
Copyright 2026 SSH Desktop Contributors

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```

---

<p align="center">
  Developed with ❤️ for developers, sysadmins, and DevOps engineers worldwide.
</p>
