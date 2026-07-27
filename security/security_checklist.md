# Checklist securite SecureERP Cloud

| Controle | Statut |
| --- | --- |
| Le fichier `.env` n'est pas versionne | A verifier |
| `SECRET_KEY` est change avant production | A verifier |
| UFW autorise seulement SSH, HTTP, HTTPS | A verifier |
| Fail2ban est actif pour SSH | A verifier |
| L'acces root SSH est desactive | A verifier |
| L'authentification SSH par cle est activee | A verifier |
| Les sauvegardes sont testees | A verifier |
| Les permissions de la base SQLite sont limitees | A verifier |
| Les logs Docker et Nginx sont consultables | A verifier |
| Netdata est limite au reseau prive | A verifier |
