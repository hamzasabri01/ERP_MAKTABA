# Conclusion generale

Le projet SecureERP Cloud a permis de concevoir une infrastructure Cloud privee simple, securisee et supervisee pour heberger ProERP Web. La solution repond aux besoins principaux: deploiement Docker, reverse proxy Nginx, pare-feu, protection SSH, monitoring et sauvegarde.

## Limites

- SQLite reste adapte a un usage limite.
- HTTPS doit etre finalise selon le contexte reseau.
- La haute disponibilite n'est pas incluse.

## Perspectives

- Migration vers Kubernetes.
- Ajout d'une chaine CI/CD.
- Ajout Prometheus/Grafana.
- Migration vers PostgreSQL.
- Deploiement sur OpenStack.
- Ajout d'un WAF.
- Authentification MFA.
