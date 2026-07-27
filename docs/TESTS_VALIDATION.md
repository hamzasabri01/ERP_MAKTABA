# Tests et validation

| Test | Objectif | Procedure | Resultat attendu | Resultat reel | Statut |
| --- | --- | --- | --- | --- | --- |
| Acces application | Verifier l'interface web | Ouvrir `http://IP_SERVEUR/` | Page de connexion visible | A completer | A completer |
| Health API | Verifier le backend | `curl http://IP_SERVEUR/health` | `status: ok` | A completer | A completer |
| Reverse proxy | Verifier Nginx | Appeler `/api/auth/login` via Nginx | Reponse API | A completer | A completer |
| Firewall | Verifier UFW | `sudo ufw status` | Ports 22, 80, 443 autorises | A completer | A completer |
| SSH | Verifier durcissement | Tester connexion par cle | Connexion autorisee | A completer | A completer |
| Fail2ban | Verifier protection SSH | `sudo fail2ban-client status sshd` | Jail active | A completer | A completer |
| Backup | Tester sauvegarde | `bash scripts/backup_proerp.sh` | Archive generee | A completer | A completer |
| Restore | Tester restauration | `bash scripts/restore_proerp.sh ARCHIVE` | Application fonctionnelle | A completer | A completer |
| Monitoring | Verifier Netdata | Ouvrir port 19999 | Dashboard visible | A completer | A completer |
| Redemarrage Docker | Tester resilience | `docker compose restart` | Services reviennent healthy | A completer | A completer |
