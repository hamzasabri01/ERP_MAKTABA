# Monitoring avec Netdata

Le monitoring permet de verifier la disponibilite, la performance et la stabilite de SecureERP Cloud dans l'infrastructure Cloud privee.

## Installation

```bash
sudo bash monitoring/install_netdata.sh
```

Acces au tableau de bord:

```text
http://ADRESSE_IP_SERVEUR:19999
```

Limiter ce port au reseau prive avec UFW:

```bash
sudo MONITORING_CIDR=192.168.1.0/24 bash security/firewall_ufw.sh
```

## Indicateurs a surveiller

| Indicateur | Objectif |
| --- | --- |
| CPU | Detecter une surcharge du backend |
| RAM | Verifier la consommation des conteneurs |
| Disque | Eviter le remplissage par logs ou backups |
| Reseau | Observer le trafic HTTP/API |
| Docker | Suivre l'etat des conteneurs |
| System load | Detecter une saturation globale |
| Disponibilite | Tester `/health` et l'acces web |

## Captures recommandees pour le rapport

- Tableau de bord Netdata global.
- Graphiques CPU/RAM pendant l'utilisation de l'application.
- Etat des conteneurs Docker.
- Espace disque avant et apres generation d'une sauvegarde.
- Test de disponibilite de l'endpoint `/health`.

## Option avancee

Prometheus et Grafana peuvent etre ajoutes dans une evolution future, mais Netdata reste suffisant et realiste pour un PFE Licence Professionnelle.
