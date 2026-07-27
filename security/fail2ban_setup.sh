#!/usr/bin/env bash
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run with sudo: sudo bash security/fail2ban_setup.sh"
  exit 1
fi

apt-get update
apt-get install -y fail2ban

cat >/etc/fail2ban/jail.d/sshd-secureerp.conf <<'EOF'
[sshd]
enabled = true
port = ssh
filter = sshd
logpath = %(sshd_log)s
maxretry = 5
findtime = 10m
bantime = 1h
EOF

systemctl enable --now fail2ban
systemctl restart fail2ban
fail2ban-client status sshd
