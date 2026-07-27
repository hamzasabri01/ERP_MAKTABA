# Chapitre 5 : Tests et validation

Les tests valident l'acces a l'application, la disponibilite de l'API, le fonctionnement du reverse proxy, la securite reseau, le monitoring et la sauvegarde.

| Test | Resultat attendu |
| --- | --- |
| Acces a l'application | La page de connexion s'affiche |
| API healthcheck | `/health` retourne `status: ok` |
| Nginx reverse proxy | Les requetes `/api` atteignent le backend |
| UFW | Seuls les ports autorises sont ouverts |
| Fail2ban | Le jail SSH est actif |
| Netdata | Le dashboard affiche les metriques |
| Backup | Une archive est creee |
| Restore | Les donnees sont restaurees |

Les resultats reels doivent etre completes apres execution sur la VM Ubuntu.
