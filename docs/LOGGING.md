# Journalisation

## Backend FastAPI

Consulter les logs:

```bash
docker compose logs -f backend
```

Le niveau de log est configurable avec `LOG_LEVEL` dans `.env`.

## Nginx

```bash
docker compose logs -f nginx
```

Dans un deploiement systeme classique, les logs Nginx sont dans:

```text
/var/log/nginx/access.log
/var/log/nginx/error.log
```

## Docker

```bash
docker compose ps
docker compose logs --tail=100
```

## Systeme Ubuntu

```bash
journalctl -xe
sudo dmesg
```

## Fail2ban

```bash
sudo fail2ban-client status sshd
sudo journalctl -u fail2ban
```

## Sauvegardes

Les scripts ecrivent dans:

```text
backups/backup.log
backups/restore.log
```
