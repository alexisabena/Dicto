#!/usr/bin/env bash
# Dicto — VPS bootstrap + deploy
# Run once on a fresh Hostinger KVM2 (Ubuntu 24)
# Usage: bash deploy.sh

set -euo pipefail

REPO="https://github.com/alexisabena/Dicto.git"
APP_DIR="/opt/dicto"
DATA_DIR="/var/dicto/data"
NODE_VERSION="20"
DOMAIN="${DOMAIN:-}"   # set DOMAIN=yourdomain.com before running

echo "==> Updating system"
apt-get update -qq && apt-get upgrade -y -qq

echo "==> Installing Node.js ${NODE_VERSION}"
curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash -
apt-get install -y nodejs

echo "==> Installing Nginx + Certbot"
apt-get install -y nginx certbot python3-certbot-nginx git

echo "==> Cloning repo"
if [ -d "$APP_DIR" ]; then
  git -C "$APP_DIR" pull
else
  git clone "$REPO" "$APP_DIR"
fi

echo "==> Installing Node dependencies"
cd "$APP_DIR/api"
npm ci --omit=dev

echo "==> Creating data directory"
mkdir -p "$DATA_DIR/sessions"
chown -R www-data:www-data "$DATA_DIR" 2>/dev/null || true

echo "==> Writing .env"
if [ ! -f "$APP_DIR/api/.env" ]; then
  cat > "$APP_DIR/api/.env" << EOF
OPENAI_API_KEY=REPLACE_ME
PORT=3000
DATA_DIR=${DATA_DIR}
NODE_ENV=production
EOF
  echo "  ! Edit $APP_DIR/api/.env and add your OPENAI_API_KEY"
fi

echo "==> Installing systemd service"
cat > /etc/systemd/system/dicto.service << EOF
[Unit]
Description=Dicto API
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=${APP_DIR}/api
ExecStart=/usr/bin/node src/server.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable dicto
systemctl restart dicto

echo "==> Configuring Nginx"
cat > /etc/nginx/sites-available/dicto << EOF
server {
    listen 80;
    server_name ${DOMAIN:-_};

    client_max_body_size 32M;

    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Host              \$host;
        proxy_set_header   X-Real-IP         \$remote_addr;
        proxy_set_header   X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
        proxy_read_timeout 120s;
    }
}
EOF

ln -sf /etc/nginx/sites-available/dicto /etc/nginx/sites-enabled/dicto
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

if [ -n "$DOMAIN" ]; then
  echo "==> Requesting SSL certificate for $DOMAIN"
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "alexisfy@gmail.com"
fi

echo ""
echo "Done. Dicto is running at http://${DOMAIN:-$(curl -s ifconfig.me)}"
echo ""
echo "Next steps:"
echo "  1. Edit $APP_DIR/api/.env — add OPENAI_API_KEY"
echo "  2. systemctl restart dicto"
if [ -z "$DOMAIN" ]; then
  echo "  3. Point your domain to this server, then rerun with DOMAIN=yourdomain.com bash deploy.sh"
fi
