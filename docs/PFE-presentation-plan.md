# Plan de presentation PFE

## Titre

Conception et mise en place d'un ERP securise sur infrastructure virtualisee avec audit trail et sauvegarde cloud chiffree.

## Duree conseillee

15 a 20 minutes.

---

## Slide 1: Page de garde

- Titre du projet.
- Nom et formation.
- Encadrant.
- Annee universitaire.

---

## Slide 2: Contexte

- Les PME utilisent des ERP pour centraliser leurs donnees.
- Ces donnees sont sensibles: ventes, stock, caisse, clients.
- Besoin de securite, tracabilite et sauvegarde.

Message oral:

> Le projet part d'une application ERP reelle et l'enrichit par des modules cybersécurite et cloud prive.

---

## Slide 3: Problematique

Question:

> Comment securiser un ERP web local tout en assurant l'audit, l'integrite des logs et la sauvegarde chiffree?

Points:

- Acces non autorise.
- Suppression/modification non tracee.
- Perte ou fuite des backups.
- Besoin de deploiement LAN/VM.

---

## Slide 4: Objectifs

- Controle d'acces RBAC.
- Security Center.
- Audit trail.
- Hash-chain integrity.
- Backup chiffre.
- Deploiement VM/Docker.

---

## Slide 5: Architecture generale

```text
Users LAN -> Frontend React -> Backend FastAPI -> SQLite local
                                      |
                                      +-> Audit hash-chain
                                      +-> Backups chiffres
                                      +-> Security Center
```

Capture conseillee:

`screenshots/02-dashboard.png`

---

## Slide 6: Module 1 - Cybersecurity

- Roles et permissions.
- Tracking login success/failed.
- Audit trail.
- IP et User-Agent.
- Risk score.

Capture:

`screenshots/03-security-center.png`

---

## Slide 7: Audit Trail et hash-chain

Principe:

```text
hash_n = SHA256(previous_hash + data_n)
```

Avantage:

- Detection des modifications.
- Verification d'integrite.
- Approche inspiree blockchain.

Demo:

- Ouvrir Security Center.
- Montrer `Audit integrity`.

---

## Slide 8: Module 2 - Backup & Disaster Recovery

- Backup complet: database + settings + uploads.
- Backup chiffre `.erpenc`.
- Passphrase.
- Restauration.
- Backup de securite avant restore.

Capture:

`screenshots/04-backup-chiffre.png`

---

## Slide 9: Module 3 - Virtualisation / Cloud prive

- Deploiement sur VM.
- Acces LAN par IP.
- Dockerfile et docker-compose.
- Persistance des donnees.
- Compatible avec stockage VMFS/NFS/vSAN.

Commandes:

```powershell
docker compose build
docker compose up -d
```

---

## Slide 10: Interfaces principales

Montrer rapidement:

- Login: `screenshots/01-login.png`
- Dashboard: `screenshots/02-dashboard.png`
- Reports: `screenshots/05-reports.png`
- Users/Roles: `screenshots/06-users-roles.png`

---

## Slide 11: Tests et validation

Table:

| Test | Resultat |
|---|---|
| Build frontend | Reussi |
| Health API | OK |
| Security Center | OK |
| Audit integrity | OK |
| Backup chiffre | OK |

---

## Slide 12: Demonstration live

Ordre conseille:

1. Login.
2. Security Center.
3. Tentative login echouee.
4. Retour Security Center.
5. Creation backup chiffre.
6. Verification audit integrity.

---

## Slide 13: Apports du projet

- Application ERP reelle.
- Securite applicative.
- Supervision cybersécurite.
- Sauvegarde chiffree.
- Deploiement virtualise.

Lien avec formation:

- Cybersecurity.
- Administration systeme et reseaux.
- Virtualisation.
- Docker/conteneurs.
- Stockage et sauvegarde.

---

## Slide 14: Limites

- Pas encore de MFA.
- Pas encore de SIEM externe.
- Pas encore de HTTPS reverse proxy integre.
- Backup cloud automatique encore optionnel.

---

## Slide 15: Perspectives

- MFA/2FA.
- Reverse proxy HTTPS.
- Backup automatique vers NFS/cloud.
- Alertes email securite.
- Integration SIEM.
- Monitoring infrastructure.

---

## Slide 16: Conclusion

Phrase finale:

> Ce projet montre comment une application ERP locale peut devenir une solution securisee, auditable et deployable sur infrastructure virtualisee, tout en conservant une base de donnees locale et des sauvegardes chiffrees.

---

# Questions probables et reponses courtes

## Pourquoi garder SQLite local?

Pour garantir la disponibilite en LAN, reduire les couts et garder la souverainete des donnees.

## Pourquoi chiffrer les backups?

Parce que les sauvegardes contiennent toutes les donnees sensibles. Si elles sont volees, le chiffrement limite le risque.

## Pourquoi hash-chain et pas blockchain complet?

Le besoin est l'integrite des logs, pas un reseau distribue. Une hash-chain est plus simple, adaptee et suffisante pour detecter la modification.

## Pourquoi Docker?

Pour faciliter le deploiement, isoler l'application et rendre la solution portable entre VM ou serveurs.

## Qu'est-ce que RBAC?

Role-Based Access Control: chaque utilisateur a un role, et chaque role contient des permissions.

## Comment detecter une attaque brute-force?

Le systeme journalise les `login_failed`. Si le nombre augmente, le Security Center augmente le risk score et genere une alerte.
