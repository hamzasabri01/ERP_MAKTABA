# SecureERP Cloud

SecureERP Cloud est la version PFE de ProERP Web: une application ERP Web preparee pour un deploiement dans une infrastructure Cloud privee locale, avec Docker, Nginx, UFW, Fail2ban, Netdata et un systeme de sauvegarde/restauration.

## Contexte PFE

**Titre :** Conception, deploiement et securisation d'une infrastructure Cloud privee pour l'hebergement d'une application ERP Web

**Objectif :** heberger ProERP Web dans un environnement Ubuntu Server securise, supervise et sauvegarde en utilisant uniquement des outils gratuits et open source.

## Technologies

| Couche | Technologie |
| --- | --- |
| Frontend | React, Vite |
| Backend | Python, FastAPI |
| Base de donnees | SQLite |
| Reverse proxy | Nginx |
| Conteneurisation | Docker Compose |
| Securite | UFW, Fail2ban, headers HTTP |
| Monitoring | Netdata |
| Sauvegarde | Scripts Bash, archives tar.gz |

## Architecture

```text
Utilisateur
  -> Nginx Reverse Proxy
      -> Frontend React/Vite
      -> Backend FastAPI
          -> SQLite
          -> Uploads
          -> Backups
```

Voir aussi: `docs/ARCHITECTURE.md`.

## Installation locale Windows

Backend:

```powershell
cd backend
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
uvicorn main:app --host 0.0.0.0 --port 8015 --reload
```

Frontend:

```powershell
cd frontend
npm install
copy .env.example .env
npm run dev
```

Acces local: `http://localhost:5173`

Identifiants initiaux si la base est vide: `admin` / `admin123`

## Installation locale Linux

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn main:app --host 0.0.0.0 --port 8015 --reload
```

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

## Deploiement Docker

```bash
cp .env.example .env
docker compose up -d --build
docker compose ps
curl http://localhost/health
```

Services:

- `backend`: API FastAPI interne sur le port 8015.
- `nginx`: frontend public et reverse proxy sur le port 80.

## Deploiement Ubuntu Server

```bash
sudo bash deployment/install_server.sh
cp .env.example .env
nano .env
bash deployment/deploy.sh
```

Documentation detaillee: `docs/DEPLOYMENT_UBUNTU.md`.

## Securite

```bash
sudo SSH_PORT=22 bash security/firewall_ufw.sh
sudo bash security/fail2ban_setup.sh
```

Guides:

- `docs/SECURITY.md`
- `security/ssh_hardening.md`
- `security/security_checklist.md`

## Monitoring

```bash
sudo bash monitoring/install_netdata.sh
```

Dashboard: `http://ADRESSE_IP_SERVEUR:19999`

Guide: `docs/MONITORING.md`.

## Sauvegarde et restauration

Sauvegarde:

```bash
bash scripts/backup_proerp.sh
```

Restauration:

```bash
bash scripts/restore_proerp.sh backups/secureerp-backup-YYYYMMDD-HHMMSS.tar.gz
```

Guide PRA: `docs/BACKUP_PRA.md`.

## Logs utiles

```bash
docker compose logs -f backend
docker compose logs -f nginx
sudo fail2ban-client status sshd
```

Guide: `docs/LOGGING.md`.

## Tests de validation

Voir `docs/TESTS_VALIDATION.md`.

## Documentation PFE

Le dossier `PFE/` contient le plan du rapport, les chapitres, le script de soutenance et la liste des captures d'ecran a prendre.

## Depannage rapide

| Probleme | Action |
| --- | --- |
| Docker absent | Installer Docker avec `deployment/install_server.sh` |
| API inaccessible | Verifier `docker compose logs backend` |
| Frontend inaccessible | Verifier `docker compose logs nginx` |
| Erreur CORS | Verifier `CORS_ORIGINS` dans `.env` |
| Donnees perdues | Restaurer la derniere archive dans `backups/` |
