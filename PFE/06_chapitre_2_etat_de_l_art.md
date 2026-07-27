# Chapitre 2 : Etat de l'art

Le Cloud Computing permet de fournir des ressources informatiques a la demande. Dans un Cloud prive, l'organisation conserve le controle de l'infrastructure, des donnees et des politiques de securite.

La virtualisation avec VirtualBox ou VMware permet d'isoler un serveur Ubuntu. La conteneurisation avec Docker facilite le deploiement reproductible de l'application. Nginx joue le role de reverse proxy, sert le frontend et redirige les requetes API vers le backend.

La cybersecurite Cloud repose sur plusieurs couches: pare-feu, durcissement SSH, limitation des secrets, supervision, journalisation et sauvegarde. UFW simplifie la gestion du pare-feu, Fail2ban limite les attaques par force brute, Netdata fournit une supervision temps reel et le PRA formalise la restauration apres incident.
