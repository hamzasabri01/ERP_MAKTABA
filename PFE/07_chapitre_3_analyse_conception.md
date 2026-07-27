# Chapitre 3 : Analyse et conception

## Besoins fonctionnels

- Acces a l'application ERP depuis un navigateur.
- Authentification des utilisateurs.
- Gestion des modules ERP existants.
- Sauvegarde et restauration des donnees.

## Besoins non fonctionnels

- Securite des acces.
- Disponibilite du service.
- Simplicite d'exploitation.
- Utilisation d'outils open source.

## Choix technologiques

| Besoin | Technologie |
| --- | --- |
| Frontend | React/Vite |
| Backend | FastAPI |
| Base de donnees | SQLite |
| Reverse proxy | Nginx |
| Conteneurisation | Docker Compose |
| Pare-feu | UFW |
| Protection SSH | Fail2ban |
| Monitoring | Netdata |

## Analyse des risques

Les principaux risques sont l'exposition des secrets, les acces SSH non controles, la perte de donnees, l'indisponibilite du service et l'absence de supervision.
