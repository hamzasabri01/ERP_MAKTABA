#!/usr/bin/env bash
set -euo pipefail

SSH_PORT="${SSH_PORT:-22}"
MONITORING_CIDR="${MONITORING_CIDR:-}"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run with sudo: sudo SSH_PORT=22 bash security/firewall_ufw.sh"
  exit 1
fi

ufw --force reset
ufw default deny incoming
ufw default allow outgoing

ufw allow "${SSH_PORT}/tcp" comment "SSH"
ufw allow 80/tcp comment "HTTP"
ufw allow 443/tcp comment "HTTPS"

if [ -n "$MONITORING_CIDR" ]; then
  ufw allow from "$MONITORING_CIDR" to any port 19999 proto tcp comment "Netdata private access"
fi

ufw --force enable
ufw status verbose
