# Annexes

## Commandes utiles

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f
curl http://ADRESSE_IP_SERVEUR/health
sudo ufw status verbose
sudo fail2ban-client status sshd
bash scripts/backup_proerp.sh
```

## Fichiers importants

- `docker-compose.yml`
- `Dockerfile`
- `deployment/nginx-proerp.conf`
- `security/firewall_ufw.sh`
- `monitoring/install_netdata.sh`
- `scripts/backup_proerp.sh`
