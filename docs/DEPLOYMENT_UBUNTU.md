# Deploiement Ubuntu Server

## Environnement cible

- Ubuntu Server dans VirtualBox ou VMware.
- Docker et Docker Compose.
- Nginx comme reverse proxy.
- UFW, Fail2ban, Netdata et sauvegardes automatisees.

## Installation du serveur

1. Creer une VM Ubuntu Server avec 2 CPU, 4 Go RAM et 30 Go disque minimum.
2. Mettre a jour le systeme:

```bash
sudo apt update && sudo apt upgrade -y
```

3. Installer les prerequis:

```bash
sudo bash deployment/install_server.sh
```

## Deploiement de l'application

```bash
cp .env.example .env
nano .env
bash deployment/deploy.sh
```

Changer au minimum `SECRET_KEY`.

## Verification

```bash
docker compose ps
curl http://ADRESSE_IP_SERVEUR/health
```

Ouvrir dans le navigateur:

```text
http://ADRESSE_IP_SERVEUR/
```

## Mise a jour

```bash
bash deployment/update.sh
```

## Depannage

| Probleme | Verification |
| --- | --- |
| Page inaccessible | `docker compose ps`, `sudo ufw status` |
| API indisponible | `curl http://localhost/health` |
| Erreur build frontend | `docker compose build nginx` |
| Erreur backend | `docker compose logs backend` |
| Port 80 occupe | `sudo ss -tulpn | grep :80` |
