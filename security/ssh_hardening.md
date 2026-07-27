# Durcissement SSH

Ce guide decrit les actions recommandees pour securiser l'acces SSH du serveur Ubuntu qui heberge SecureERP Cloud.

## Recommandations

- Utiliser une paire de cles SSH au lieu d'un mot de passe.
- Desactiver la connexion directe de l'utilisateur `root`.
- Desactiver l'authentification par mot de passe uniquement apres validation de la connexion par cle.
- Limiter l'acces SSH aux administrateurs autorises.
- Changer le port SSH uniquement si cela est documente dans la procedure d'exploitation.
- Activer Fail2ban pour bloquer les tentatives repetitives.

## Parametres a verifier

Modifier `/etc/ssh/sshd_config` avec prudence:

```text
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
```

Tester la configuration avant de redemarrer le service:

```bash
sudo sshd -t
sudo systemctl restart ssh
```

Garder une session SSH ouverte pendant le test afin d'eviter de perdre l'acces au serveur.
