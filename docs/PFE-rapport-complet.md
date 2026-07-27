# Projet de Fin d'Etudes

## Conception et mise en place d'un ERP securise sur infrastructure virtualisee avec audit trail et sauvegarde cloud chiffree

### Formation

Licence: Cybersecurity and Cloud Computing

### Application support

ProERP Web: application ERP web pour la gestion des produits, ventes, achats, clients, fournisseurs, stock, caisse, rapports, utilisateurs et parametres.

---

## Resume

Ce projet consiste a concevoir, securiser et deployer une application ERP web dans une architecture hybride local/cloud. L'objectif est de transformer une application de gestion classique en une solution professionnelle orientee cybersécurite, supervision, audit, sauvegarde chiffree et deploiement sur infrastructure virtualisee.

Le systeme propose repose sur trois modules principaux:

- Cybersecurity: authentification, RBAC, Security Center, journal d'audit et detection d'anomalies.
- Backup & Disaster Recovery: sauvegarde complete, sauvegarde chiffree, restauration et historique.
- Virtualisation / Cloud prive: deploiement LAN, Docker, VM et persistance des donnees locales.

La solution garde la base de donnees principale en local afin de garantir la souverainete des donnees et la disponibilite dans un reseau interne, tout en ajoutant des mecanismes de securite et de resilience adaptes a un contexte professionnel.

---

## Abstract

This final year project focuses on securing and deploying a web-based ERP application on a virtualized infrastructure. The project introduces a cybersecurity layer including role-based access control, audit trail, security monitoring, login tracking and hash-chain integrity verification. It also implements encrypted backups and disaster recovery procedures. The application is designed for a hybrid local/cloud deployment where the main database remains local while the system can be managed and backed up through secure mechanisms.

---

## Mots cles

ERP, Cybersecurity, Cloud Computing, Virtualisation, RBAC, Audit Trail, Hash Chain, Backup Chiffre, Disaster Recovery, FastAPI, React, Docker, vSphere.

---

# Chapitre 1: Contexte general

## 1.1 Introduction

Les entreprises utilisent de plus en plus des systemes ERP pour centraliser leurs processus internes: gestion commerciale, stock, achats, ventes, caisse et rapports. Cependant, ces systemes manipulent des donnees sensibles et doivent etre securises contre les acces non autorises, les pertes de donnees, les erreurs humaines et les modifications non tracees.

Dans le cadre d'une licence Cybersecurity and Cloud Computing, ce projet vise a enrichir une application ERP existante par des modules de securite et de deploiement professionnel, tout en respectant les contraintes des petites et moyennes entreprises: cout reduit, installation locale, acces LAN et sauvegarde fiable.

## 1.2 Problematique

Une application ERP locale peut fonctionner correctement pour la gestion quotidienne, mais elle presente plusieurs risques:

- Absence de supervision securite centralisee.
- Difficulté a identifier les tentatives d'acces non autorise.
- Risque de modification ou suppression non tracee.
- Absence de verification d'integrite des journaux.
- Sauvegardes non chiffrees et vulnerables en cas de fuite.
- Deploiement difficile sur un autre poste ou une VM.

La question principale est donc:

Comment securiser et deployer un ERP web local tout en assurant la tracabilite, l'integrite des journaux et la sauvegarde chiffree des donnees?

## 1.3 Objectifs

Les objectifs du projet sont:

- Mettre en place un controle d'acces base sur les roles.
- Centraliser la supervision de securite dans un Security Center.
- Tracer les actions sensibles dans un journal d'audit.
- Ajouter une chaine de hachage pour verifier l'integrite des logs.
- Ajouter la sauvegarde chiffree et la restauration.
- Fournir une architecture de deploiement LAN/VM/Docker.
- Produire une solution exploitable comme PFE et comme application reelle.

## 1.4 Perimetre du projet

Le projet ne cherche pas a couvrir tous les domaines de la cybersécurite. Il se concentre sur trois modules principaux:

1. Cybersecurity applicative.
2. Backup & Disaster Recovery.
3. Virtualisation / Cloud prive.

Ce choix permet d'avoir un projet coherent, realisable et defendable.

---

# Chapitre 2: Analyse de l'existant

## 2.1 Presentation de ProERP Web

ProERP Web est une application ERP composee d'un frontend React/Vite et d'un backend FastAPI. Elle permet:

- Gestion des produits et categories.
- Gestion du stock et mouvements.
- Gestion des ventes, devis, factures et achats.
- Gestion des clients et fournisseurs.
- Gestion de la caisse.
- Rapports financiers.
- Parametres de l'entreprise.
- Gestion des utilisateurs et roles.

## 2.2 Architecture technique existante

```text
Navigateur
   |
   v
Frontend React/Vite
   |
   v
Backend FastAPI
   |
   v
SQLite local + uploads + settings
```

## 2.3 Limites identifiees

Avant l'ajout des modules PFE, les limites principales etaient:

- Audit existant mais sans verification d'integrite.
- Sauvegarde disponible mais non chiffree.
- Pas de tableau de bord securite dedie.
- Peu de visibilite sur les connexions echouees.
- Deploiement local possible, mais non formalise pour VM/Docker.

---

# Chapitre 3: Cahier des charges

## 3.1 Besoins fonctionnels

Le systeme doit permettre:

- Authentifier les utilisateurs.
- Associer chaque utilisateur a un role.
- Limiter l'acces aux modules selon les permissions.
- Enregistrer les actions importantes dans un audit trail.
- Afficher un Security Center.
- Detecter les tentatives de connexion echouees.
- Calculer un score de risque.
- Verifier l'integrite du journal d'audit.
- Creer une sauvegarde complete.
- Creer une sauvegarde chiffree.
- Restaurer une sauvegarde.
- Deployer l'application sur LAN, VM ou Docker.

## 3.2 Besoins non fonctionnels

- Interface claire et responsive.
- Donnees principales conservees en local.
- Sauvegardes protegees par chiffrement.
- Acces interne via IP LAN.
- Architecture simple a deployer sur une VM.
- Possibilite d'extension vers cloud backup ou NFS.

## 3.3 Contraintes

- Base de donnees principale locale.
- Solution gratuite ou faible cout.
- Compatible avec Windows et environnement LAN.
- Deploiement possible sans Cloudflared ni tunnel temporaire.

---

# Chapitre 4: Conception de la solution

## 4.1 Architecture cible

```text
Utilisateurs LAN
   |
   | HTTP interne
   v
Serveur ERP / VM / Container
   |
   +-- Frontend React build
   +-- Backend FastAPI
   +-- Security Center
   +-- Audit hash-chain
   |
   +-- SQLite local
   +-- Uploads
   +-- Backups locaux et chiffres
   |
   v
Stockage externe optionnel
   - NFS datastore
   - VMFS/vSAN datastore
   - Cloud backup
```

## 4.2 Module 1: Cybersecurity

Le module cybersécurite se compose de:

- RBAC.
- Security Center.
- Audit Trail.
- Hash-chain integrity.
- Tracking des connexions.

## 4.3 Module 2: Backup & Disaster Recovery

Le module sauvegarde comprend:

- Sauvegarde `.zip` classique.
- Sauvegarde chiffree `.erpenc`.
- Restauration.
- Backup de securite avant restauration.
- Historique des backups.

## 4.4 Module 3: Virtualisation / Cloud prive

Le module deploiement comprend:

- Execution sur un poste serveur LAN.
- Deploiement sur VM.
- Variante Docker Compose.
- Persistance des donnees par volumes ou dossiers mappes.

---

# Chapitre 5: Realisation

## 5.1 Technologies utilisees

Frontend:

- React.
- Vite.
- Recharts.
- Lucide icons.

Backend:

- FastAPI.
- SQLAlchemy.
- SQLite.
- JWT.
- Cryptography/Fernet.

Deploiement:

- Docker.
- Docker Compose.
- LAN server.
- VM Windows/Linux.

## 5.2 RBAC et permissions

Le systeme utilise des roles:

- admin.
- manager.
- cashier.
- warehouse.
- viewer ou roles personnalisables.

Chaque role contient une liste de permissions telles que:

- dashboard.
- sales.
- purchases.
- products.
- stock.
- cash.
- reports.
- users.
- settings.

Le backend applique les permissions au niveau des routes API. Le frontend masque aussi les menus non autorises.

## 5.3 Audit Trail

Chaque action importante est enregistree:

- Creation, modification, suppression.
- Ventes, achats, stock, caisse.
- Sauvegardes.
- Connexions reussies.
- Connexions echouees.

Chaque log contient:

- Action.
- Entite.
- Identifiant.
- Resume.
- Donnees avant/apres.
- Utilisateur.
- Date.
- Adresse IP.
- User-Agent.
- Hash du log.
- Hash precedent.

## 5.4 Hash-chain integrity

Pour detecter les modifications non autorisees dans les logs, chaque entree d'audit est liee a la precedente:

```text
hash_n = SHA256(previous_hash + action + entity + data + user + timestamp + ip)
```

Si un ancien log est modifie, le hash calcule ne correspond plus. Le Security Center peut alors signaler une incoherence.

## 5.5 Security Center

Le Security Center presente:

- Risk score.
- Nombre de connexions echouees.
- Connexions reussies.
- Actions sensibles.
- IPs uniques.
- Alertes.
- Etat d'integrite du journal.
- Activite recente.

Le score de risque est calcule a partir:

- Des tentatives de connexion echouees.
- Des actions sensibles.
- De l'etat d'integrite des logs.

## 5.6 Backup chiffre

Le systeme permet deux types de sauvegardes:

- `.zip`: sauvegarde standard.
- `.erpenc`: sauvegarde chiffree.

La sauvegarde chiffree utilise:

- Une passphrase utilisateur.
- PBKDF2-HMAC-SHA256.
- Fernet pour le chiffrement authentifie.

Le fichier chiffre protege:

- `proerp.db`.
- `company_settings.json`.
- `uploads`.

## 5.7 Restauration

Avant chaque restauration, le systeme cree automatiquement une sauvegarde de securite. Cela permet de revenir en arriere si une erreur se produit.

## 5.8 Docker et VM

Le projet contient:

- `Dockerfile`.
- `docker-compose.yml`.
- Documentation de deploiement.

Commandes:

```powershell
docker compose build
docker compose up -d
```

Acces:

```text
http://localhost:8015/erp
http://SERVER-IP:8015/erp
```

---

# Chapitre 6: Interfaces et captures d'ecran

## 6.1 Page d'authentification

![Login](screenshots/01-login.png)

Cette interface permet a l'utilisateur de s'authentifier. Les tentatives reussies et echouees sont journalisees dans l'audit.

## 6.2 Tableau de bord principal

![Dashboard](screenshots/02-dashboard.png)

Le tableau de bord donne une vue globale sur les ventes, benefices, stock, caisse et activite recente.

## 6.3 Security Center

![Security Center](screenshots/03-security-center.png)

Cette interface est le coeur du module cybersécurite. Elle affiche le score de risque, les alertes, les logs recents et l'etat d'integrite.

## 6.4 Sauvegarde chiffree

![Backup chiffre](screenshots/04-backup-chiffre.png)

Cette interface permet de creer une sauvegarde locale ou une sauvegarde chiffree avec passphrase.

## 6.5 Rapports

![Reports](screenshots/05-reports.png)

Les rapports permettent l'analyse financiere et operationnelle.

## 6.6 Roles et utilisateurs

![Users roles](screenshots/06-users-roles.png)

Cette interface gere les utilisateurs, roles et permissions.

## 6.7 Version mobile du Security Center

![Security mobile](screenshots/07-security-mobile.png)

Le module cybersécurite reste exploitable sur mobile, utile pour l'administrateur en mobilite.

---

# Chapitre 7: Tests et validation

## 7.1 Tests fonctionnels

| Test | Resultat attendu | Statut |
|---|---|---|
| Connexion admin | Acces a l'application | Valide |
| Connexion echouee | Log `login_failed` | Valide |
| Acces Security Center | Affichage score et alertes | Valide |
| Verification audit integrity | `ok=true` si logs intacts | Valide |
| Creation backup chiffre | Fichier `.erpenc` cree | Valide |
| Suppression backup | Backup supprime | Valide |
| Build frontend | Build Vite reussi | Valide |
| Health API | `status=ok` | Valide |

## 7.2 Resultats de verification

Verification effectuee:

```text
Health: {"status":"ok","version":"1.0.0"}
Audit integrity: ok=true
Security Center: endpoint operationnel
Encrypted backup: creation et suppression testees
Frontend build: reussi
```

## 7.3 Scenarios de demonstration

1. Se connecter avec un utilisateur admin.
2. Ouvrir Security Center.
3. Provoquer une tentative de login echouee.
4. Observer l'alerte et l'augmentation du risk score.
5. Verifier l'integrite des logs.
6. Creer une sauvegarde chiffree.
7. Telecharger la sauvegarde.
8. Montrer l'architecture Docker/VM.

---

# Chapitre 8: Securite et bonnes pratiques

## 8.1 Principe du moindre privilege

Chaque utilisateur ne doit avoir que les permissions necessaires a son travail.

## 8.2 Tracabilite

Les operations sensibles sont conservees dans un audit trail consultable par l'administrateur.

## 8.3 Confidentialite des sauvegardes

Les sauvegardes chiffrees protegent les donnees meme si le fichier est copie ou vole.

## 8.4 Disponibilite

Le mode LAN permet au systeme de fonctionner sans dependance a un tunnel externe.

## 8.5 Integrite

La hash-chain rend detectables les modifications des journaux.

---

# Chapitre 9: Deploiement sur infrastructure virtualisee

## 9.1 Deploiement VM

Le systeme peut etre installe sur une VM Windows ou Linux:

- Installation backend/frontend.
- Exposition du port 8015.
- Acces LAN via IP.
- Stockage des backups sur disque local ou partage NFS.

## 9.2 Deploiement Docker

Docker permet:

- Isolation du service.
- Portabilite.
- Redemarrage automatique.
- Persistance par volumes/dossiers.

## 9.3 Integration avec vSphere

Dans un environnement vSphere:

- VM ProERP.
- Datastore VMFS ou NFS pour la VM.
- Snapshot avant mise a jour.
- Backup vers datastore externe.
- Segmentation reseau entre utilisateurs, administration et sauvegarde.

---

# Chapitre 10: Conclusion

Ce PFE a permis de transformer une application ERP en une solution securisee et deployable sur infrastructure virtualisee. Les modules implementes repondent aux besoins principaux d'une PME: controle d'acces, supervision securite, audit, detection d'activite suspecte, sauvegarde chiffree et deploiement local/VM/Docker.

Le projet illustre concretement les competences de la licence Cybersecurity and Cloud Computing:

- Securite applicative.
- Administration systeme et reseau.
- Virtualisation.
- Backup & Disaster Recovery.
- Cloud prive et conteneurisation.

## Perspectives

Les ameliorations futures possibles:

- Ajout MFA/2FA.
- Export PDF du Security Center.
- Backup automatique vers NFS ou cloud.
- Alertes email en cas de risque eleve.
- Reverse proxy HTTPS.
- Integration SIEM externe.

---

# Annexes

## A. Endpoints principaux

```text
GET  /api/security-center/overview
GET  /api/audit/integrity
POST /api/backups
POST /api/backups/encrypted
POST /api/backups/restore
POST /api/backups/restore-encrypted
```

## B. Fichiers importants

```text
backend/api/routes/security_center.py
backend/api/routes/backups.py
backend/api/audit.py
backend/models/audit.py
frontend/src/pages/SecurityCenterPage.jsx
frontend/src/pages/SettingsPage.jsx
Dockerfile
docker-compose.yml
docs/PFE-architecture.md
```

## C. Identifiants de demonstration

```text
Utilisateur: admin
Mot de passe: admin123
```

En production, ce mot de passe doit etre change immediatement.
