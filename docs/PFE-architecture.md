# PFE - ERP securise sur infrastructure virtualisee

## Titre propose

Conception et mise en place d'un ERP securise sur infrastructure virtualisee avec audit trail et sauvegarde cloud chiffree.

## Modules principaux

1. Cybersecurity
   - RBAC: roles et permissions applicatives.
   - Security Center: score de risque, failed logins, actions sensibles.
   - Audit trail: tracabilite des ventes, achats, stock, caisse, sauvegardes et authentification.
   - Audit integrity: hash-chain inspiree blockchain pour detecter l'alteration des journaux.

2. Backup & Disaster Recovery
   - Sauvegarde complete: database, settings et uploads.
   - Sauvegarde chiffree `.erpenc` avec passphrase.
   - Restauration avec sauvegarde de securite avant remplacement.
   - Historique des sauvegardes et verification SQLite.

3. Virtualisation / Cloud prive
   - Deploiement sur VM Windows ou Linux.
   - Variante conteneurisee avec Docker Compose.
   - Acces LAN par IP: `http://SERVER-IP:8015/erp`.
   - Stockage persistant pour database, backups, settings et uploads.

## Architecture cible

```text
Utilisateurs LAN
  |
  | HTTP/HTTPS interne
  v
VM ERP / Container ProERP
  - React frontend build
  - FastAPI backend
  - Security Center
  - Audit hash-chain
  |
  +-- SQLite local: proerp.db
  +-- Uploads produits/documents
  +-- Backups locaux et chiffres
  |
  v
Stockage externe optionnel
  - NFS datastore
  - VMFS/vSAN datastore
  - Cloud backup
```

## Scenarios de demonstration

1. Connexion reussie et connexion echouee.
2. Visualisation dans Security Center: failed logins, IP, user, risk score.
3. Creation d'une vente ou modification stock puis apparition dans audit trail.
4. Verification de l'integrite des logs.
5. Creation d'une sauvegarde chiffree.
6. Restauration depuis une sauvegarde chiffree.
7. Deploiement sur VM ou container Docker.

## Commandes Docker

```powershell
docker compose build
docker compose up -d
```

Application:

```text
http://localhost:8015/erp
http://SERVER-IP:8015/erp
```

## Points a expliquer dans le rapport

- Pourquoi garder la database principale en local: souverainete, disponibilite LAN, faible cout.
- Pourquoi chiffrer les sauvegardes: confidentialite et protection en cas de fuite.
- Pourquoi utiliser RBAC: principe du moindre privilege.
- Pourquoi utiliser hash-chain: detection d'alteration des journaux.
- Pourquoi deployer sur VM/container: isolation, portabilite et administration systeme.
