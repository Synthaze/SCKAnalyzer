# Configuration for setup_server.sh.
#
# Copy this file to config.sh (same directory) and adjust the values for
# your server, then run: sudo ./setup_server.sh
#
# config.sh is gitignored — it typically contains host-specific paths and
# should not be committed.

APP_USER="appuser"                  # unix user that owns/runs the app
APP_DIR="/opt/sckanalyzer"          # path to the checked-out repository
VENV_DIR="/opt/sckanalyzer-venv"    # path for the backend virtualenv
SERVICE_NAME="sckanalyzer-backend"  # systemd unit name
NGINX_SITE="sckanalyzer"            # nginx site name
BACKEND_PORT=8000                   # local port uvicorn listens on
