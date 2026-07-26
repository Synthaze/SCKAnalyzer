#!/usr/bin/env bash
#
# Provisions this Ubuntu box to host the SCK Analysis app (FastAPI backend +
# React/Vite frontend) behind nginx on port 80, no TLS, IP-only access.
#
# Run as: sudo ./setup_server.sh
#
# What it does:
#   - installs system packages: nginx, ufw, python3-venv, Node.js 20 LTS
#   - (re)builds the backend virtualenv and installs Python deps
#   - builds the frontend static bundle (npm ci && npm run build)
#   - installs a systemd unit that runs uvicorn on 127.0.0.1:8000
#   - installs an nginx site that serves the frontend and reverse-proxies
#     /api/ to the backend, replacing the distro default site
#
# No firewall (ufw) is configured on this container by design: exposure is
# gated externally (port-forward/NAT/reverse proxy at the router or Proxmox
# host), and that's treated as the sole boundary here.
#
# It does NOT touch anything outside this container: no domain, no TLS
# cert, no router/NAT config. Making this box reachable from the public
# internet (port-forwarding 80 -> this container's LAN IP, or a reverse
# proxy on the Proxmox host) is assumed to be handled elsewhere.
#
# Safe to re-run: every step is idempotent.

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Run this with sudo: sudo $0" >&2
  exit 1
fi

APP_USER="florian"
APP_DIR="/home/florian/sck-analysis_v0.9"
BACKEND_DIR="$APP_DIR/backend"
FRONTEND_DIR="$APP_DIR/frontend"
VENV_DIR="/home/florian/env"
SERVICE_NAME="sck-backend"
NGINX_SITE="sck-analysis"
BACKEND_PORT=8000

if [[ ! -d "$APP_DIR" ]]; then
  echo "Expected app at $APP_DIR — not found." >&2
  exit 1
fi

echo "==> Installing system packages"
apt-get update -qq
apt-get install -y --no-install-recommends \
  nginx curl ca-certificates gnupg \
  python3-venv python3-pip

if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | grep -oE '^v[0-9]+' | tr -d v)" -lt 18 ]]; then
  echo "==> Installing Node.js 20.x (NodeSource)"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
else
  echo "==> Node.js already present: $(node -v)"
fi

echo "==> (Re)building backend virtualenv"
# Wipe any pre-existing venv: it may have been created with a Python
# interpreter that no longer exists on this box (broken symlink/binary).
if [[ -d "$VENV_DIR" ]] && ! "$VENV_DIR/bin/python3" --version >/dev/null 2>&1; then
  echo "    existing venv is broken, recreating"
  rm -rf "$VENV_DIR"
fi
if [[ ! -d "$VENV_DIR" ]]; then
  sudo -u "$APP_USER" python3 -m venv "$VENV_DIR"
fi
sudo -u "$APP_USER" "$VENV_DIR/bin/pip" install --upgrade pip -q
sudo -u "$APP_USER" "$VENV_DIR/bin/pip" install -r "$BACKEND_DIR/requirements.txt" -q

echo "==> Building frontend"
sudo -u "$APP_USER" bash -c "cd '$FRONTEND_DIR' && npm ci && npm run build"

echo "==> Installing systemd service: $SERVICE_NAME"
cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=SCK Analysis FastAPI backend
After=network.target

[Service]
Type=simple
User=${APP_USER}
Group=${APP_USER}
WorkingDirectory=${BACKEND_DIR}
ExecStart=${VENV_DIR}/bin/uvicorn app.main:app --host 127.0.0.1 --port ${BACKEND_PORT} --workers 2
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ReadWritePaths=${APP_DIR}

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "$SERVICE_NAME"
systemctl restart "$SERVICE_NAME"

echo "==> Granting nginx (www-data) traversal into ${APP_USER}'s home"
# nginx serves the frontend straight out of $APP_USER's home dir, which is
# mode 750 (owner-only). Adding www-data to the app user's group grants it
# just the existing group r-x bit (traversal), not world access.
usermod -a -G "$APP_USER" www-data

echo "==> Installing nginx site: $NGINX_SITE"
cat > "/etc/nginx/sites-available/${NGINX_SITE}" <<EOF
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    # CSV/FRD uploads can exceed nginx's 1M default.
    client_max_body_size 50m;

    root ${FRONTEND_DIR}/dist;
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:${BACKEND_PORT};
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location / {
        try_files \$uri \$uri/ /index.html;
    }
}
EOF

# The stock Ubuntu default site also claims port 80 as default_server,
# which conflicts with the block above — disable it.
rm -f /etc/nginx/sites-enabled/default
ln -sf "/etc/nginx/sites-available/${NGINX_SITE}" "/etc/nginx/sites-enabled/${NGINX_SITE}"

nginx -t
# restart (not reload): picks up the new www-data group membership above,
# which a plain reload of an already-running master may not apply.
systemctl restart nginx

echo
echo "==> Done."
systemctl --no-pager --lines=0 status "$SERVICE_NAME" || true
echo
LAN_IP="$(hostname -I | awk '{print $1}')"
echo "App should be reachable on this LAN at: http://${LAN_IP}/"
echo "Backend health check: http://127.0.0.1:${BACKEND_PORT}/api/health"
echo
echo "Reminder: this only configures the container itself. Reaching it from"
echo "the public internet still needs whatever port-forward / reverse proxy"
echo "you're setting up at the router or Proxmox host level (-> port 80 on"
echo "${LAN_IP})."
