# Chapitre 4 : Realisation

La realisation commence par la preparation d'une machine Ubuntu Server dans VirtualBox ou VMware. Docker et Docker Compose sont installes afin d'executer l'application dans des conteneurs.

Le backend FastAPI est deploye dans un conteneur dedie. Le frontend React/Vite est compile puis servi par Nginx. Nginx redirige les routes `/api`, `/uploads` et `/health` vers le backend.

La securisation est assuree par UFW, Fail2ban, les en-tetes HTTP de securite et la protection des fichiers sensibles. Netdata est installe pour la supervision et des scripts Bash automatisent la sauvegarde et la restauration.
