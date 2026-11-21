# Linux and servers

## Native installation

Target: Debian/Ubuntu or 64-bit Raspberry Pi OS. Requirements: Bash, Node.js 24 LTS with npm; for local AI, Python 3.10–3.13, python3-venv, libglib2.0-0 and libgl1. Install Node from its official distribution. Python packages go into a virtual environment, never the system Python.

```bash
sudo apt-get update
sudo apt-get install -y git ca-certificates python3 python3-venv libglib2.0-0 libgl1
# Clone the repository and enter its directory.
bash scripts/install-linux.sh --with-ai --check-only
bash scripts/install-linux.sh --with-ai
bash scripts/start-linux.sh
```

Omit `--with-ai` without local image analysis. Installation requires internet, uses npm ci and Python binary wheels, and verifies model SHA256 hashes. If no wheel is available, review the CPU/Python combination instead of starting uncontrolled source builds.

## systemd service

The simple service helper requires `/opt/tuerwache`. Create a dedicated user and copy clean source under that user's ownership:

```bash
sudo useradd --system --create-home --home-dir /var/lib/tuerwache --shell /usr/sbin/nologin tuerwache
sudo install -d -o tuerwache -g tuerwache /opt/tuerwache
# Transfer clean source into /opt/tuerwache as user tuerwache.
cd /opt/tuerwache
sudo -u tuerwache bash scripts/install-linux.sh --with-ai
sudo -u tuerwache mkdir -p data
# Test a manual start and stop cleanly before installing the service.
sudo -u tuerwache bash scripts/start-linux.sh
sudo bash scripts/install-service.sh --user tuerwache
sudo systemctl status tuerwache
sudo journalctl -u tuerwache -f
```

Never overwrite an existing installation's accounts/data. Existing service units are preserved. Stop using `sudo systemctl stop tuerwache`; shutdown allows up to 260 seconds for work to drain. Hardening permits writes only to data and temporary storage. Custom clip directories require an explicit ReadWritePaths entry and file permissions. Run Ollama as its own service.

## Remote first setup

The app listens on loopback. Open an SSH tunnel, then browse localhost:3210:

```bash
ssh -L 3210:127.0.0.1:3210 user@server
```

Configure HTTPS, allowed hosts and MFA before enabling Server & access. See [operations](operations.en.md).

## Docker

`deploy/compose.yaml` is a Linux host-network template with an optional Caddy profile. Copy deploy/.env.example to deploy/.env, set a domain and a private random 64-character hex encryption key. Back up the key separately. Start the app first using `docker compose -f deploy/compose.yaml up -d --build app`. Public HTTPS requires explicitly starting the external profile after setup. See deploy/README.md. This template is not directly suitable for Docker Desktop or multiple tenants.
