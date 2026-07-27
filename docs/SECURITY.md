# Securite de SecureERP Cloud

SecureERP Cloud est concu pour un deploiement dans une infrastructure Cloud privee locale basee sur Ubuntu Server, Docker, Nginx, UFW, Fail2ban et Netdata.

## Mesures appliquees

- Reverse proxy Nginx devant l'API FastAPI.
- En-tetes HTTP de securite: CSP, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` et COOP.
- Variables sensibles separees dans `.env`.
- Le mot de passe SMTP est fourni uniquement par `SMTP_PASSWORD`; l'API retourne seulement un indicateur configure/non configure.
- Les champs sensibles sont expurges des nouveaux journaux d'audit; l'outil `backend/tools/scrub_audit_secrets.py` traite l'historique et reconstruit la chaine d'integrite.
- En production, le backend refuse de demarrer avec une `SECRET_KEY` par defaut ou de moins de 32 caracteres.
- Les access tokens expirent par defaut en 15 minutes et restent uniquement en memoire JavaScript.
- Le refresh token est place dans un cookie HttpOnly, tourne a chaque renouvellement et est protege par CSRF.
- `session_version` invalide les anciens tokens apres changement de mot de passe, logout, reset administrateur ou changement MFA sensible.
- Local Login et Firebase appliquent la meme politique MFA.
- Les secrets TOTP sont chiffres au repos; les codes de recuperation sont stockes uniquement sous forme de hashes et sont a usage unique.
- Les limites login/MFA/refresh sont persistantes dans SQLite et donc partagees par les workers.
- `X-Forwarded-For` n'est accepte qu'avec `TRUST_PROXY_HEADERS=true` et une adresse source presente dans `TRUSTED_PROXY_IPS`.
- Les images sont limitees a 2 MB et controlees par extension, MIME et signature binaire (JPG, PNG, WebP uniquement).
- La restauration ZIP refuse les chemins dangereux, liens symboliques, fichiers inattendus et archives surdimensionnees avant toute modification des donnees.
- Base SQLite non exposee au reseau.
- Conteneur backend non publie directement sur Internet.
- Healthcheck applicatif via `/health`.

## Pare-feu

Executer:

```bash
sudo SSH_PORT=22 bash security/firewall_ufw.sh
```

Ports recommandes:

| Port | Usage |
| --- | --- |
| 22/tcp | SSH |
| 80/tcp | HTTP |
| 443/tcp | HTTPS futur |
| 19999/tcp | Netdata, uniquement reseau prive |

## Fail2ban

Executer:

```bash
sudo bash security/fail2ban_setup.sh
```

Verifier:

```bash
sudo fail2ban-client status sshd
```

## Protection des donnees

- Donner des permissions restrictives aux fichiers sensibles: `chmod 600 .env backend/proerp.db`.
- Limiter l'acces au serveur aux administrateurs.
- Tester regulierement la restauration des sauvegardes.
- Ne jamais publier `.env`, les bases `.db`, les logs ou les sauvegardes.
- Utiliser une sauvegarde `.erpenc` avec une passphrase forte pour tout stockage externe. Les ZIP sont explicitement non chiffres.

## Recommandations production

- Activer HTTPS avec Let's Encrypt ou un certificat interne.
- Definir une `SECRET_KEY` aleatoire unique d'au moins 32 caracteres avant tout demarrage production.
- Configurer `SMTP_PASSWORD` dans le gestionnaire de secrets ou le fichier `.env` protege; ne jamais le remettre dans `company_settings.json`.
- Pour un frontend et une API de meme origine, conserver `COOKIE_SAMESITE=strict`. Pour un frontend Firebase separe, utiliser HTTPS, `COOKIE_SECURE=true` et `COOKIE_SAMESITE=none`; le proxy same-origin reste recommande.
- Retirer `INITIAL_ADMIN_PASSWORD` de l'environnement apres la creation initiale du premier administrateur.
- Conserver `SECRET_KEY` de facon durable: elle protege les tokens, le chiffrement MFA et les hashes de recovery. Toute rotation exige une procedure de re-chiffrement planifiee.
- Configurer une politique de rotation des logs.
- Ajouter un WAF ou des regles Nginx avancees si l'application devient exposee publiquement.
- Migrer vers PostgreSQL si plusieurs utilisateurs concurrents utilisent fortement l'ERP.
