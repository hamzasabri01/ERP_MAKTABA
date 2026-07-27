# Sauvegarde et PRA

## Objectif

La strategie de sauvegarde de SecureERP Cloud vise a proteger la base SQLite, les fichiers de configuration et les fichiers televerses afin de restaurer le service apres incident.

## Sauvegarde

Depuis l'interface ProERP, deux formats sont disponibles:

- `.zip`: sauvegarde locale complete mais non chiffree; un avertissement est affiche dans l'interface et dans l'API.
- `.erpenc`: sauvegarde chiffree par passphrase, recommandee pour tout transfert ou stockage externe.

La copie SQLite est produite avec l'API de sauvegarde SQLite afin d'inclure les transactions validees presentes dans le journal WAL.

Executer manuellement:

```bash
bash scripts/backup_proerp.sh
```

Planification cron quotidienne a 02:00:

```cron
0 2 * * * cd /opt/secureerp-cloud && bash scripts/backup_proerp.sh
```

Les archives sont stockees dans `backups/` au format:

```text
secureerp-backup-YYYYMMDD-HHMMSS.tar.gz
```

## Restauration

La restauration depuis l'interface valide integralement l'archive avant de toucher aux donnees actives:

- limite de taille du fichier recu;
- limite du nombre de membres et de la taille decompressee;
- refus des chemins absolus, `..`, antislashs et liens symboliques;
- liste blanche des fichiers racine et des extensions d'images;
- presence unique de `proerp.db`, `PRAGMA integrity_check` et tables ERP obligatoires;
- creation automatique d'une sauvegarde de securite avant remplacement.

1. Choisir une archive valide dans `backups/`.
2. Executer:

```bash
bash scripts/restore_proerp.sh backups/secureerp-backup-YYYYMMDD-HHMMSS.tar.gz
```

3. Verifier le service:

```bash
curl http://ADRESSE_IP_SERVEUR/health
```

## Scenario d'incident

Incident: corruption de la base SQLite ou suppression accidentelle d'un fichier de configuration.

Procedure:

- Arreter les conteneurs.
- Restaurer la derniere archive saine.
- Redemarrer l'application.
- Valider l'acces au tableau de bord et aux donnees principales.

## RTO et RPO

| Indicateur | Valeur cible |
| --- | --- |
| RTO | 30 minutes |
| RPO | 24 heures avec sauvegarde quotidienne |

## Tests de validation

- Generer une sauvegarde.
- Verifier la presence de l'archive.
- Restaurer sur une copie de test.
- Verifier `/health`.
- Verifier l'acces a l'interface et aux donnees ERP.
