#!/usr/bin/env bash
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run with sudo: sudo bash monitoring/install_netdata.sh"
  exit 1
fi

apt-get update
apt-get install -y curl

bash <(curl -Ss https://my-netdata.io/kickstart.sh) --stable-channel --disable-telemetry

systemctl enable --now netdata
systemctl status netdata --no-pager

echo "Netdata dashboard: http://SERVER_IP:19999"
